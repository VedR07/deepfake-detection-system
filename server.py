from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import uuid
import threading

print("Starting imports...")

try:
    from analyzer import analyze_video
    print("Analyzer imported successfully")
except Exception as e:
    print("ERROR importing analyzer:", e)
    exit(1)

print("Creating Flask app...")
app = Flask(__name__)
CORS(app)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
print("Upload directory created:", UPLOAD_DIR)

jobs = {}

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(".", path)

@app.route("/api/upload", methods=["POST"])
def upload():
    file = request.files["video"]
    job_id = str(uuid.uuid4())
    path = os.path.join(UPLOAD_DIR, "{}.mp4".format(job_id))
    file.save(path)
    jobs[job_id] = {"status": "uploaded", "progress": 0}
    return jsonify({"job_id": job_id})

@app.route("/api/analyze/<job_id>", methods=["POST"])
def analyze(job_id):
    def run():
        try:
            jobs[job_id]["status"] = "processing"
            result = analyze_video(
                os.path.join(UPLOAD_DIR, "{}.mp4".format(job_id)),
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
    print("=" * 50)
    print("  DeepShield AI - Server Starting")
    print("=" * 50)
    print("")
    print("Server will run at: http://localhost:5000")
    print("Press Ctrl+C to stop")
    print("=" * 50)
    print("")
    
    try:
        app.run(host="0.0.0.0", port=5000, debug=False)
    except Exception as e:
        print("ERROR starting server:", e)
        import traceback
        traceback.print_exc()