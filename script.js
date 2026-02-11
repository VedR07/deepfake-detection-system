const API = "http://localhost:5000/api";
let job = null;

async function start() {
  const fileInput = document.getElementById("file");

  if (!fileInput.files.length) {
    alert("Please select a video file");
    return;
  }

  document.getElementById("resultSection").classList.add("hidden");
  document.getElementById("status").textContent = "Uploading video...";
  updateProgress(5);

  const fd = new FormData();
  fd.append("video", fileInput.files[0]);

  const upload = await fetch(API + "/upload", {
    method: "POST",
    body: fd
  });

  const data = await upload.json();
  job = data.job_id;

  document.getElementById("status").textContent = "Analyzing video...";
  await fetch(API + "/analyze/" + job, { method: "POST" });

  poll();
}

async function poll() {
  const res = await fetch(API + "/status/" + job);
  const data = await res.json();

  updateProgress(data.progress || 50);
  document.getElementById("status").textContent =
    "Processing: " + data.status;

  if (data.status !== "completed") {
    setTimeout(poll, 1000);
  } else {
    loadResults();
  }
}

async function loadResults() {
  document.getElementById("status").textContent = "Analysis complete";
  updateProgress(100);

  const res = await fetch(API + "/results/" + job);
  const data = await res.json();

  document.getElementById("resultSection").classList.remove("hidden");

  const verdictElement = document.getElementById("verdict");
  verdictElement.textContent =
    data.verdict + " (" + data.risk_level + " risk)";

  if (data.risk_level === "HIGH") {
    verdictElement.style.color = "#ef4444";
  } else if (data.risk_level === "MEDIUM") {
    verdictElement.style.color = "#facc15";
  } else {
    verdictElement.style.color = "#22c55e";
  }

  const confidencePercent = data.confidence * 100;
  const bar = document.getElementById("confidenceBar");

  bar.style.width = confidencePercent + "%";

  if (confidencePercent > 75) {
    bar.style.background = "#ef4444";
  } else if (confidencePercent > 45) {
    bar.style.background = "#facc15";
  } else {
    bar.style.background = "#22c55e";
  }

  document.getElementById("output").textContent =
    JSON.stringify(data, null, 2);
}

function updateProgress(percent) {
  document.getElementById("progress").style.width = percent + "%";
}
