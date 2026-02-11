const API = "http://localhost:5000/api";
let job = null;
let currentFile = null;
let currentMode = 'video';

// Webcam Detection Variables
let webcamStream = null;
let faceMesh = null;
let animationFrame = null;
let isWebcamRunning = false;

// Temporal Graph Variables
let temporalGraphCtx = null;
let graphData = {
  eyes: [],
  mouth: [],
  brows: []
};
let previousLandmarks = null;
const MAX_GRAPH_POINTS = 100;
const TEMPORAL_EDGES = [
  { from: 'eyes', to: 'mouth' },
  { from: 'brows', to: 'eyes' }
];

// Face landmarks indices
const REGIONS = {
  eyes: [33, 133, 159, 145],
  mouth: [61, 291, 13, 14],
  brows: [65, 295]
};

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

// Webcam Elements
const webcamVideo = document.getElementById("webcamVideo");
const webcamCanvas = document.getElementById("webcamCanvas");
const temporalGraphCanvas = document.getElementById("temporalGraph");
const videoSection = document.getElementById("videoSection");
const webcamSection = document.getElementById("webcamSection");
const startWebcamBtn = document.getElementById("startWebcamBtn");
const stopWebcamBtn = document.getElementById("stopWebcamBtn");

// Mode Switching
function switchMode(mode) {
  currentMode = mode;
  
  // Update button states
  document.getElementById('videoModeBtn').classList.toggle('active', mode === 'video');
  document.getElementById('webcamModeBtn').classList.toggle('active', mode === 'webcam');
  
  // Toggle sections
  videoSection.classList.toggle('hidden', mode !== 'video');
  webcamSection.classList.toggle('hidden', mode !== 'webcam');
  
  // Hide results when switching modes
  resultSection.classList.add('hidden');
  
  // Stop webcam if switching away
  if (mode !== 'webcam' && isWebcamRunning) {
    stopWebcam();
  }
  
  // Update status
  if (mode === 'video') {
    updateStatus("Awaiting upload", "idle");
  } else {
    updateStatus("Ready for live detection", "idle");
  }
}

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

// ==================== WEBCAM DETECTION ====================

async function startWebcam() {
  try {
    // Request webcam access
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }
    });
    
    webcamVideo.srcObject = webcamStream;
    
    // Wait for video to be ready
    await new Promise((resolve) => {
      webcamVideo.onloadedmetadata = () => {
        resolve();
      };
    });
    
    // Setup canvas
    webcamCanvas.width = webcamVideo.videoWidth;
    webcamCanvas.height = webcamVideo.videoHeight;
    
    // Initialize temporal graph canvas
    if (!temporalGraphCtx) {
      temporalGraphCtx = temporalGraphCanvas.getContext('2d');
      temporalGraphCanvas.width = temporalGraphCanvas.offsetWidth;
      temporalGraphCanvas.height = 200;
    }
    
    // Initialize MediaPipe FaceMesh
    if (!faceMesh) {
      faceMesh = new FaceMesh({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
        }
      });
      
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      
      faceMesh.onResults(onFaceMeshResults);
    }
    
    // Update UI
    isWebcamRunning = true;
    startWebcamBtn.classList.add('hidden');
    stopWebcamBtn.classList.remove('hidden');
    updateStatus("Live detection active", "analyzing");
    
    // Start detection loop
    detectFrame();
    
  } catch (error) {
    console.error("Webcam error:", error);
    showError("Could not access webcam. Please check permissions.");
  }
}

function stopWebcam() {
  isWebcamRunning = false;
  
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  
  // Clear canvas
  const ctx = webcamCanvas.getContext('2d');
  ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
  
  // Reset UI
  startWebcamBtn.classList.remove('hidden');
  stopWebcamBtn.classList.add('hidden');
  updateStatus("Detection stopped", "idle");
  
  // Reset graph data
  graphData = { eyes: [], mouth: [], brows: [] };
  previousLandmarks = null;
}

async function detectFrame() {
  if (!isWebcamRunning) return;
  
  // Send frame to FaceMesh
  await faceMesh.send({ image: webcamVideo });
  
  // Continue loop
  animationFrame = requestAnimationFrame(detectFrame);
}

function regionCenter(landmarks, indices) {
  let sumX = 0, sumY = 0;
  indices.forEach(i => {
    sumX += landmarks[i].x;
    sumY += landmarks[i].y;
  });
  return {
    x: sumX / indices.length,
    y: sumY / indices.length
  };
}

function onFaceMeshResults(results) {
  const ctx = webcamCanvas.getContext('2d');
  ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
  
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];
    
    // Draw face mesh
    drawFaceMesh(ctx, landmarks);
    
    // Calculate region centers
    const regions = {};
    for (const [regionName, indices] of Object.entries(REGIONS)) {
      regions[regionName] = regionCenter(landmarks, indices);
    }
    
    // Calculate temporal graph metrics
    if (previousLandmarks) {
      const prevRegions = {};
      for (const [regionName, indices] of Object.entries(REGIONS)) {
        prevRegions[regionName] = regionCenter(previousLandmarks, indices);
      }
      
      // Calculate movement for each region
      const movements = {};
      for (const regionName of Object.keys(REGIONS)) {
        const dx = regions[regionName].x - prevRegions[regionName].x;
        const dy = regions[regionName].y - prevRegions[regionName].y;
        movements[regionName] = Math.sqrt(dx * dx + dy * dy);
        
        // Add to graph data
        graphData[regionName].push(movements[regionName]);
        if (graphData[regionName].length > MAX_GRAPH_POINTS) {
          graphData[regionName].shift();
        }
      }
      
      // Calculate temporal edge inconsistencies
      let graphIncoherence = 0;
      for (const edge of TEMPORAL_EDGES) {
        const deltaA = movements[edge.from];
        const deltaB = movements[edge.to];
        graphIncoherence += Math.abs(deltaA - deltaB);
      }
      graphIncoherence /= TEMPORAL_EDGES.length;
      
      // Simple frequency artifact estimation (based on movement variance)
      const eyesVariance = calculateVariance(graphData.eyes);
      const frequencyArtifacts = eyesVariance;
      
      // Calculate confidence score (simplified version of backend algorithm)
      const rawScore = (1.6 * graphIncoherence) + (1.1 * frequencyArtifacts);
      const confidence = sigmoid(rawScore);
      
      // Determine verdict
      let verdict, riskLevel, iconClass;
      if (confidence > 0.75) {
        verdict = "DEEPFAKE";
        riskLevel = "HIGH";
        iconClass = "danger";
      } else if (confidence > 0.45) {
        verdict = "SUSPICIOUS";
        riskLevel = "MEDIUM";
        iconClass = "warning";
      } else {
        verdict = "AUTHENTIC";
        riskLevel = "LOW";
        iconClass = "";
      }
      
      // Update live verdict display
      updateLiveVerdict(verdict, confidence, iconClass);
      updateLiveMetrics(graphIncoherence, frequencyArtifacts, riskLevel);
      
      // Update temporal graph
      drawTemporalGraph();
    }
    
    previousLandmarks = landmarks;
  }
}

function drawFaceMesh(ctx, landmarks) {
  // Draw landmark points
  ctx.fillStyle = 'rgba(0, 255, 136, 0.4)';
  landmarks.forEach(landmark => {
    ctx.beginPath();
    ctx.arc(
      landmark.x * webcamCanvas.width,
      landmark.y * webcamCanvas.height,
      1,
      0,
      2 * Math.PI
    );
    ctx.fill();
  });
  
  // Highlight key regions
  const regionColors = {
    eyes: 'rgba(0, 255, 136, 0.6)',
    mouth: 'rgba(255, 0, 128, 0.6)',
    brows: 'rgba(0, 212, 255, 0.6)'
  };
  
  for (const [regionName, indices] of Object.entries(REGIONS)) {
    ctx.fillStyle = regionColors[regionName];
    indices.forEach(i => {
      ctx.beginPath();
      ctx.arc(
        landmarks[i].x * webcamCanvas.width,
        landmarks[i].y * webcamCanvas.height,
        3,
        0,
        2 * Math.PI
      );
      ctx.fill();
    });
  }
}

function drawTemporalGraph() {
  if (!temporalGraphCtx) return;
  
  const ctx = temporalGraphCtx;
  const width = temporalGraphCanvas.width;
  const height = temporalGraphCanvas.height;
  
  // Clear canvas
  ctx.fillStyle = 'rgba(10, 10, 20, 0.3)';
  ctx.fillRect(0, 0, width, height);
  
  // Draw grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  
  // Draw data lines
  const colors = {
    eyes: '#00ff88',
    mouth: '#ff0080',
    brows: '#00d4ff'
  };
  
  for (const [regionName, data] of Object.entries(graphData)) {
    if (data.length < 2) continue;
    
    ctx.strokeStyle = colors[regionName];
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const maxValue = Math.max(...data, 0.01);
    
    data.forEach((value, i) => {
      const x = (i / MAX_GRAPH_POINTS) * width;
      const y = height - (value / maxValue) * height * 0.8;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
  }
}

function updateLiveVerdict(verdict, confidence, iconClass) {
  const liveVerdictIcon = document.getElementById('liveVerdictIcon');
  const liveVerdictText = document.getElementById('liveVerdictText');
  const liveConfidence = document.getElementById('liveConfidence');
  
  liveVerdictText.textContent = verdict;
  liveConfidence.textContent = Math.round(confidence * 100) + '%';
  
  // Update icon
  let iconHTML = '';
  if (iconClass === 'danger') {
    iconHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  } else if (iconClass === 'warning') {
    iconHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  } else {
    iconHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  
  liveVerdictIcon.innerHTML = iconHTML;
  liveVerdictIcon.className = 'live-verdict-icon ' + iconClass;
}

function updateLiveMetrics(coherence, artifacts, risk) {
  document.getElementById('liveCoherence').textContent = coherence.toFixed(4);
  document.getElementById('liveArtifacts').textContent = artifacts.toFixed(4);
  
  const riskBadge = document.getElementById('liveRisk');
  riskBadge.textContent = risk;
  riskBadge.className = 'metric-value risk-badge';
  if (risk === 'HIGH') {
    riskBadge.classList.add('high');
  } else if (risk === 'MEDIUM') {
    riskBadge.classList.add('medium');
  }
}

function calculateVariance(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  analyzeBtn.disabled = true;
});