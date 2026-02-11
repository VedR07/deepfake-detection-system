const API = "http://localhost:5000/api";
let job = null;
let currentFile = null;

// DOM Elements
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("file");
const filePreview = document.getElementById("filePreview");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const removeFileBtn = document.getElementById("removeFile");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusSection = document.getElementById("statusSection");
const statusText = document.getElementById("status");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progress");
const resultSection = document.getElementById("resultSection");

// Initialize drag and drop
dropZone.addEventListener("click", () => {
  fileInput.click();
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    handleFileSelect();
  }
});

// File input change
fileInput.addEventListener("change", handleFileSelect);

// Remove file button
removeFileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  clearFile();
});

function handleFileSelect() {
  const file = fileInput.files[0];
  
  if (!file) return;
  
  // Validate file type
  if (!file.type.startsWith("video/")) {
    showError("Please select a valid video file");
    clearFile();
    return;
  }
  
  // Validate file size (500MB max)
  const maxSize = 500 * 1024 * 1024; // 500MB in bytes
  if (file.size > maxSize) {
    showError("File size exceeds 500MB limit");
    clearFile();
    return;
  }
  
  currentFile = file;
  
  // Update file preview
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  
  // Show file preview, hide upload area
  filePreview.classList.remove("hidden");
  analyzeBtn.disabled = false;
  
  // Update status
  updateStatus("File loaded", "idle");
  updateProgress(0);
}

function clearFile() {
  fileInput.value = "";
  currentFile = null;
  filePreview.classList.add("hidden");
  analyzeBtn.disabled = false;
  updateStatus("Awaiting upload", "idle");
  updateProgress(0);
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function updateStatus(text, state = "idle") {
  statusText.textContent = text;
  
  const pulseDot = document.querySelector(".pulse-dot");
  pulseDot.className = "pulse-dot";
  
  if (state === "analyzing") {
    pulseDot.classList.add("analyzing");
  } else if (state === "complete") {
    pulseDot.classList.add("complete");
  }
}

function updateProgress(percent) {
  progressBar.style.width = percent + "%";
  progressPercent.textContent = Math.round(percent) + "%";
}

function showError(message) {
  // Simple error display - you can enhance this with a modal or toast
  updateStatus("Error: " + message, "idle");
  setTimeout(() => {
    updateStatus("Awaiting upload", "idle");
  }, 3000);
}

async function start() {
  if (!currentFile) {
    showError("Please select a video file");
    return;
  }

  // Disable analyze button during processing
  analyzeBtn.disabled = true;
  
  // Hide previous results
  resultSection.classList.add("hidden");
  
  // Update UI state
  updateStatus("Uploading video...", "analyzing");
  updateProgress(5);

  try {
    // Upload file
    const fd = new FormData();
    fd.append("video", currentFile);

    const uploadResponse = await fetch(API + "/upload", {
      method: "POST",
      body: fd
    });

    if (!uploadResponse.ok) {
      throw new Error("Upload failed");
    }

    const uploadData = await uploadResponse.json();
    job = uploadData.job_id;

    updateStatus("Initializing analysis...", "analyzing");
    updateProgress(15);

    // Start analysis
    const analyzeResponse = await fetch(API + "/analyze/" + job, {
      method: "POST"
    });

    if (!analyzeResponse.ok) {
      throw new Error("Analysis initialization failed");
    }

    updateStatus("Analyzing video...", "analyzing");
    updateProgress(25);

    // Start polling
    poll();
    
  } catch (error) {
    console.error("Error:", error);
    showError(error.message || "An error occurred during processing");
    analyzeBtn.disabled = false;
    updateProgress(0);
  }
}

async function poll() {
  try {
    const response = await fetch(API + "/status/" + job);
    
    if (!response.ok) {
      throw new Error("Failed to get status");
    }
    
    const data = await response.json();

    // Update progress (interpolate between 25-90% during processing)
    const progress = Math.min(90, 25 + (data.progress || 0) * 0.65);
    updateProgress(progress);
    
    // Update status text
    const statusMessages = {
      "processing": "Processing frames...",
      "analyzing": "Running neural analysis...",
      "extracting": "Extracting features...",
      "computing": "Computing metrics...",
      "finalizing": "Finalizing results...",
      "completed": "Analysis complete"
    };
    
    updateStatus(statusMessages[data.status] || data.status, "analyzing");

    if (data.status !== "completed") {
      setTimeout(poll, 1000);
    } else {
      loadResults();
    }
    
  } catch (error) {
    console.error("Polling error:", error);
    showError("Connection lost. Please try again.");
    analyzeBtn.disabled = false;
  }
}

async function loadResults() {
  updateStatus("Loading results...", "analyzing");
  updateProgress(95);

  try {
    const response = await fetch(API + "/results/" + job);
    
    if (!response.ok) {
      throw new Error("Failed to load results");
    }
    
    const data = await response.json();

    updateStatus("Analysis complete", "complete");
    updateProgress(100);

    // Show results section with animation
    setTimeout(() => {
      displayResults(data);
    }, 300);
    
  } catch (error) {
    console.error("Results error:", error);
    showError("Failed to load results");
  } finally {
    analyzeBtn.disabled = false;
  }
}

function displayResults(data) {
  // Show results section
  resultSection.classList.remove("hidden");

  // Determine verdict styling
  const verdictIcon = document.getElementById("verdictIcon");
  const verdictBadge = document.querySelector(".verdict-badge");
  
  let iconHTML = "";
  let iconClass = "";
  
  if (data.verdict.toLowerCase().includes("authentic") || data.risk_level.toLowerCase() === "low") {
    iconHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    iconClass = "";
  } else if (data.risk_level.toLowerCase() === "medium") {
    iconHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    iconClass = "warning";
  } else {
    iconHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    iconClass = "danger";
  }
  
  verdictIcon.innerHTML = iconHTML;
  verdictIcon.className = "verdict-icon " + iconClass;

  // Update verdict text
  const verdictText = `${data.verdict} (${data.risk_level})`;
  document.getElementById("verdict").textContent = verdictText;

  // Update confidence bar with animation delay
  const confidencePercent = Math.round(data.confidence * 100);
  document.getElementById("confidenceValue").textContent = confidencePercent + "%";
  
  setTimeout(() => {
    document.getElementById("confidenceBar").style.width = confidencePercent + "%";
  }, 100);

  // Update metric signals
  document.getElementById("graphSignal").textContent = 
    data.signals.graph_incoherence.toFixed(4);
  document.getElementById("freqSignal").textContent = 
    data.signals.frequency_artifacts.toFixed(4);
  document.getElementById("avSignal").textContent = 
    data.signals.audio_visual_sync.toFixed(4);

  // Update timeline
  const timelineContainer = document.getElementById("timelineFrames");
  const anomalyCount = document.getElementById("anomalyCount");
  
  timelineContainer.innerHTML = "";
  
  if (data.suspicious_frames && data.suspicious_frames.length > 0) {
    anomalyCount.textContent = `${data.suspicious_frames.length} frames flagged`;
    
    data.suspicious_frames.forEach((frame, index) => {
      const pill = document.createElement("div");
      pill.className = "frame-pill";
      pill.textContent = `Frame ${frame.frame}`;
      pill.style.animationDelay = `${index * 0.05}s`;
      
      // Add click handler for frame details if available
      if (frame.timestamp) {
        pill.title = `Timestamp: ${frame.timestamp}s`;
      }
      
      timelineContainer.appendChild(pill);
    });
  } else {
    anomalyCount.textContent = "0 frames flagged";
  }

  // Scroll to results
  setTimeout(() => {
    resultSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 400);
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  analyzeBtn.disabled = true;
});