const API = "http://localhost:5000/api";
let job = null;

async function start() {
  const fileInput = document.getElementById("file");
  if (!fileInput.files.length) {
    alert("Please select a video file");
    return;
  }

  document.getElementById("status").textContent = "Uploading video…";
  updateProgress(5);

  const fd = new FormData();
  fd.append("video", fileInput.files[0]);

  const upload = await fetch(API + "/upload", {
    method: "POST",
    body: fd
  });

  const data = await upload.json();
  job = data.job_id;

  document.getElementById("status").textContent = "Analyzing video…";
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

  document.getElementById("output").textContent =
    JSON.stringify(data, null, 2);
}

function updateProgress(percent) {
  document.getElementById("progress").style.width = percent + "%";
}
