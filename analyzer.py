import cv2, numpy as np, subprocess, os
import mediapipe as mp
from scipy.io import wavfile
from scipy.signal import correlate
from math import exp

# ------------------ Setup ------------------

mp_face = mp.solutions.face_mesh
face_mesh = mp_face.FaceMesh(max_num_faces=1, refine_landmarks=True)

REGIONS = {
    "eyes": [33, 133, 159, 145],
    "mouth": [61, 291, 13, 14],
    "brows": [65, 295],
}

TEMPORAL_EDGES = [
    ("eyes", "mouth"),
    ("brows", "eyes")
]

# ------------------ Utils ------------------

def sigmoid(x):
    return 1 / (1 + exp(-x))

def extract_audio(video, audio):
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", audio],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True
        )
        return True
    except:
        return False

def region_center(landmarks, indices):
    pts = np.array([(landmarks[i].x, landmarks[i].y) for i in indices])
    return np.mean(pts, axis=0)

# ------------------ Core Analysis ------------------

def analyze_video(video_path, progress_cb=lambda x: None):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    region_traj = {r: [] for r in REGIONS}
    temporal_graph = []
    fft_scores = []
    suspicious_frames = []

    frame = 0

    while cap.isOpened():
        ret, img = cap.read()
        if not ret:
            break

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        res = face_mesh.process(rgb)

        if res.multi_face_landmarks:
            lm = res.multi_face_landmarks[0].landmark
            regions = {r: region_center(lm, idx) for r, idx in REGIONS.items()}

            for r in regions:
                region_traj[r].append(regions[r])

            if len(region_traj["eyes"]) > 1:
                graph_t = {}
                for a, b in TEMPORAL_EDGES:
                    delta = (regions[a] - region_traj[a][-2]) - \
                            (regions[b] - region_traj[b][-2])
                    graph_t[(a, b)] = np.linalg.norm(delta)

                temporal_graph.append(graph_t)

                if sum(graph_t.values()) > 0.02:
                    suspicious_frames.append({
                        "frame": frame,
                        "timestamp": frame / fps,
                        "graph_score": sum(graph_t.values())
                    })

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        fft = np.fft.fftshift(np.fft.fft2(gray))
        fft_scores.append(np.mean(np.log(np.abs(fft) + 1)[40:-40, 40:-40]))

        frame += 1
        progress_cb(int((frame / total) * 70))

    cap.release()

    # ------------------ Temporal Graph Metrics ------------------

    edge_values = {e: [] for e in TEMPORAL_EDGES}
    for g in temporal_graph:
        for e in g:
            edge_values[e].append(g[e])

    graph_incoherence = np.mean([
        np.std(edge_values[e]) for e in edge_values if len(edge_values[e]) > 1
    ]) if edge_values else 0

    # ------------------ Audio-Visual Sync ------------------

    audio_path = video_path.replace(".mp4", ".wav")
    av_sync = 0.5  # default neutral

    if extract_audio(video_path, audio_path):
        try:
            rate, audio = wavfile.read(audio_path)
            audio_env = np.abs(audio.astype(float))
            audio_env = audio_env / (np.max(audio_env) + 1e-6)

            mouth_motion = []
            m = region_traj["mouth"]
            for i in range(1, len(m)):
                mouth_motion.append(np.linalg.norm(m[i] - m[i-1]))

            if mouth_motion:
                mouth_motion = np.array(mouth_motion)
                mouth_motion /= (mouth_motion.max() + 1e-6)

                corr = correlate(
                    mouth_motion, audio_env[:len(mouth_motion)], mode="valid"
                )
                av_sync = np.clip(np.max(corr), 0, 1)
        except:
            pass

        if os.path.exists(audio_path):
            os.remove(audio_path)

    # ------------------ Final Scoring ------------------

    frequency_artifacts = np.std(fft_scores)

    raw_score = (
        1.6 * graph_incoherence +
        1.1 * frequency_artifacts +
        1.3 * (1 - av_sync)
    )

    confidence = sigmoid(raw_score)

    if confidence > 0.75:
        verdict, risk = "DEEPFAKE", "HIGH"
    elif confidence > 0.45:
        verdict, risk = "SUSPICIOUS", "MEDIUM"
    else:
        verdict, risk = "AUTHENTIC", "LOW"

    region_suspicion = {
        r: float(np.std(region_traj[r])) if len(region_traj[r]) > 2 else 0.0
        for r in region_traj
    }

    evidence = []
    if graph_incoherence > 0.02:
        evidence.append("Temporal facial graph inconsistency detected")
    if frequency_artifacts > 0.1:
        evidence.append("Frequency-domain GAN artifacts detected")
    if av_sync < 0.6:
        evidence.append("Audio-visual desynchronization detected")

    return {
        "verdict": verdict,
        "confidence": round(float(confidence), 3),
        "risk_level": risk,
        "signals": {
            "graph_incoherence": graph_incoherence,
            "frequency_artifacts": frequency_artifacts,
            "audio_visual_sync": av_sync
        },
        "region_suspicion": region_suspicion,
        "evidence": evidence,
        "suspicious_frames": suspicious_frames[:15]
    }
