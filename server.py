from flask import Flask, request, jsonify
from flask_cors import CORS
import os, uuid, threading
from analyzer import analyze_video

app = Flask(__name__)
CORS(app)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

jobs = {}

@app.route("/api/upload", methods=["POST"])
def upload():
    file = request.files["video"]
    job_id = str(uuid.uuid4())
    path = os.path.join(UPLOAD_DIR, f"{job_id}.mp4")
    file.save(path)

    jobs[job_id] = {"status": "uploaded", "progress": 0}
    return jsonify({"job_id": job_id})

@app.route("/api/analyze/<job_id>", methods=["POST"])
def analyze(job_id):
    def run():
        try:
            jobs[job_id]["status"] = "processing"
            result = analyze_video(
                os.path.join(UPLOAD_DIR, f"{job_id}.mp4"),
                lambda p: jobs[job_id].update({"progress": p})
            )
            jobs[job_id].update({
                "status": "completed",
                "progress": 100,
                "result": result
            })
        except Exception as e:
            jobs[job_id].update({"status": "failed", "error": str(e)})

    threading.Thread(target=run).start()
    return jsonify({"status": "started"})

@app.route("/api/status/<job_id>")
def status(job_id):
    return jsonify(jobs.get(job_id, {}))

@app.route("/api/results/<job_id>")
def results(job_id):
    return jsonify(jobs[job_id]["result"])

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)