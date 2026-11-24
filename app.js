// StoryVoice — three modalities, zero keys.
//   Text:  free Pollinations text API  (https://text.pollinations.ai)
//   Image: free Pollinations image API (https://image.pollinations.ai)
//   Speech: browser-native Web Speech API (SpeechSynthesis + SpeechRecognition)
// Nothing is faked: if a Pollinations call fails, the UI says so and offers a
// clearly-labelled built-in sample instead of pretending the API answered.

"use strict";

const TEXT_API = "https://text.pollinations.ai/";
const IMAGE_API = "https://image.pollinations.ai/prompt/";
const FETCH_TIMEOUT_MS = 60000;

const SURPRISE_PROMPTS = [
  "a brave little fox who finds a magic lantern in the forest",
  "a robot who learns to bake bread for a lonely lighthouse keeper",
  "a girl who trades her shadow for a ticket to the moon",
  "a sleepy dragon who runs a midnight library",
  "two rival cats who must build a bridge together before winter",
  "a paper boat that sails across a bathtub ocean to find its captain",
];

// Built-in sample, used ONLY if the live text API is unreachable.
// It is always labelled as a sample in the UI — never passed off as AI output.
const SAMPLE_STORY = {
  title: "The Little Fox and the Lantern",
  paragraphs: [
    "Once, in a forest where the fireflies kept the streetlights, a little fox named Pip found a brass lantern buried under the roots of an old oak. When she lifted it, the lantern lit by itself — warm and gold, like a small captured sunset.",
    "Pip carried the light home through the dark pines, and every creature she passed followed the glow: a tired hedgehog, a lost duckling, and a very old owl who had forgotten the way to his tree. By the time she reached her den, the whole forest was walking behind her, humming.",
    "That night the lantern never went out, and neither did the forest's new habit: whenever anyone felt lost, they only had to look for the little light bobbing between the trees, and Pip would be there, waiting, lantern in paw.",
  ],
};

const $ = (id) => document.getElementById(id);
const els = {
  prompt: $("prompt"),
  mic: $("btn-mic"),
  micHint: $("mic-hint"),
  surprise: $("btn-surprise"),
  generate: $("btn-generate"),
  promptError: $("prompt-error"),
  storyCard: $("story-card"),
  sampleBanner: $("sample-banner"),
  title: $("story-title"),
  text: $("story-text"),
  img: $("illustration"),
  imgPlaceholder: $("image-placeholder"),
  imgCaption: $("image-caption"),
  voice: $("voice"),
  rate: $("rate"),
  rateValue: $("rate-value"),
  read: $("btn-read"),
  stop: $("btn-stop"),
  narrateStatus: $("narrate-status"),
  progress: $("read-progress"),
  progressBar: $("read-progress-bar"),
  pillText: $("pill-text"),
  pillImage: $("pill-image"),
  pillSpeech: $("pill-speech"),
};

let currentSentences = [];   // flat sentences of the current story, for narration
let currentParagraphs = [];  // sentences grouped per paragraph (keeps breaks while reading)
let currentTitle = "";
let reading = false;
let visualTimer = null;
let visualIndex = -1;

function setPill(el, text, ok) {
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
  el.classList.toggle("bad", ok === false);
}

function showError(msg) {
  els.promptError.textContent = msg;
  els.promptError.hidden = false;
}

function clearError() {
  els.promptError.hidden = true;
  els.promptError.textContent = "";
}

// ---------- Speech synthesis setup ----------

function populateVoices() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  els.voice.innerHTML = "";
  if (!voices.length) {
    const opt = document.createElement("option");
    opt.textContent = "No voices found in this browser";
    els.voice.appendChild(opt);
    els.voice.disabled = true;
    return;
  }
  els.voice.disabled = false;
  const preferred = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("en"))
    || voices[0];
  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v === preferred) opt.selected = true;
    els.voice.appendChild(opt);
  });
}

function initSpeech() {
  if (!("speechSynthesis" in window)) {
    setPill(els.pillSpeech, "Speech: not supported in this browser", false);
    els.read.disabled = true;
    els.narrateStatus.textContent = "This browser has no speech synthesis — narration needs desktop Chrome, Edge or Safari.";
    return;
  }
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) {
    setPill(els.pillSpeech, `Speech: browser-native (${voices.length} voices)`, true);
  } else {
    setPill(els.pillSpeech, "Speech: browser-native (voices loading…)", true);
  }
  populateVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    populateVoices();
    const n = window.speechSynthesis.getVoices().length;
    if (n) setPill(els.pillSpeech, `Speech: browser-native (${n} voices)`, true);
  };
}

// ---------- Speech recognition (mic) ----------

let recog = null;
let listening = false;

function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    els.mic.disabled = true;
    els.mic.title = "Speech recognition is not available in this browser";
    els.micHint.textContent = "🎤 Mic input isn't available in this browser — type your prompt instead. (Speech recognition works in desktop Chrome/Edge.)";
    return;
  }
  recog = new SR();
  recog.lang = "en-US";
  recog.interimResults = false;
  recog.maxAlternatives = 1;
  recog.onresult = (e) => {
    const said = e.results[0][0].transcript.trim();
    if (said) {
      els.prompt.value = said;
      els.micHint.textContent = `Heard: “${said}” — press “Tell me a story”.`;
    }
  };
  recog.onerror = (e) => {
    els.micHint.textContent = `Mic error: ${e.error}. You can type the prompt instead.`;
    listening = false;
    els.mic.textContent = "🎤 Speak it";
  };
  recog.onend = () => {
    listening = false;
    els.mic.textContent = "🎤 Speak it";
  };
  els.mic.addEventListener("click", () => {
    if (listening) { recog.stop(); return; }
    clearError();
    try {
      recog.start();
      listening = true;
      els.mic.textContent = "🔴 Listening… (click to stop)";
      els.micHint.textContent = "Listening… speak your story idea now.";
    } catch (err) {
      els.micHint.textContent = `Could not start the microphone: ${err.message}`;
    }
  });
}

// ---------- Story generation (Pollinations text) ----------

function parseStory(raw) {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  let title = lines[0]
    .replace(/^#+\s*/, "")
    .replace(/^title:\s*/i, "")
    .replace(/^\*+/, "")
    .replace(/\*+$/, "")
    .replace(/^["“]|["”]$/g, "");
  if (title.length > 90) title = title.slice(0, 90) + "…";
  const body = lines.slice(1).join("\n");
  let paragraphs = body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paragraphs.length < 2) {
    // No blank-line breaks: chunk sentences into groups of two.
    const sentences = body.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”']?\s*/g) || [body];
    paragraphs = [];
    for (let i = 0; i < sentences.length; i += 2) {
      paragraphs.push(sentences.slice(i, i + 2).join(" ").trim());
    }
  }
  return { title, paragraphs: paragraphs.filter(Boolean) };
}

function splitSentences(paragraphs) {
  return paragraphs.map((p) => {
    const s = p.match(/[^.!?]+[.!?]+["”']?\s*/g) || [p];
    return s.map((x) => x.trim()).filter(Boolean);
  });
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function generateStory(topic) {
  const instruction = `Write a short children's story (about 150-220 words) about: ${topic}. ` +
    "Put the story title alone on the first line, then 3 short paragraphs. " +
    "Warm, whimsical, gentle humour, suitable for all ages. No preamble, no commentary.";
  const url = TEXT_API + encodeURIComponent(instruction) + "?model=openai";
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Text API returned HTTP ${res.status}`);
  const raw = (await res.text()).trim();
  const parsed = parseStory(raw);
  if (!parsed || !parsed.paragraphs.length) throw new Error("Text API returned an empty story");
  return parsed;
}

// ---------- Illustration (Pollinations image) ----------

function illustrationUrl(topic, seed) {
  const prompt = `Children's picture book illustration, ${topic}, warm and whimsical, ` +
    "soft watercolour storybook style, gentle light, no text, no words";
  return `${IMAGE_API}${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;
}

function loadIllustration(topic, seed) {
  return new Promise((resolve) => {
    const url = illustrationUrl(topic, seed);
    els.img.hidden = true;
    els.imgPlaceholder.hidden = true;
    els.imgCaption.textContent = "Drawing your illustration…";
    const img = new Image();
    img.onload = () => {
      els.img.src = url;
      els.img.hidden = false;
      els.imgCaption.textContent = `Illustration: “${topic}” — drawn by the Pollinations image API.`;
      setPill(els.pillImage, "Image API: live", true);
      resolve(true);
    };
    img.onerror = () => {
      els.imgPlaceholder.hidden = false;
      els.imgCaption.textContent = "The image API could not be reached — the story still works without it.";
      setPill(els.pillImage, "Image API: unreachable", false);
      resolve(false);
    };
    img.src = url;
    // Give slow generations a visible state; the onload/onerror above still decides.
    setTimeout(() => {
      if (els.img.hidden && els.imgPlaceholder.hidden) {
        els.imgCaption.textContent = "Drawing your illustration… (this can take ~20 seconds)";
      }
    }, 8000);
  });
}

// ---------- Rendering ----------

function renderStory(story, topic, isSample) {
  currentTitle = story.title;
  currentParagraphs = splitSentences(story.paragraphs);
  currentSentences = currentParagraphs.flat();
  els.title.textContent = story.title;
  els.text.innerHTML = "";
  story.paragraphs.forEach((p) => {
    const el = document.createElement("p");
    el.textContent = p;
    els.text.appendChild(el);
  });
  els.sampleBanner.hidden = !isSample;
  els.storyCard.hidden = false;
  els.storyCard.scrollIntoView({ behavior: "smooth", block: "start" });
  stopReading();
  els.read.disabled = false;
}

async function onGenerate() {
  const topic = els.prompt.value.trim();
  clearError();
  if (!topic) {
    showError("Tell me what the story should be about first — type it, speak it, or press “Surprise me”.");
    els.prompt.focus();
    return;
  }
  els.generate.disabled = true;
  els.generate.textContent = "✍️ Writing your story…";
  setPill(els.pillText, "Text API: asking Pollinations…", true);
  try {
    const story = await generateStory(topic);
    setPill(els.pillText, "Text API: live", true);
    renderStory(story, topic, false);
    loadIllustration(topic, Math.floor(Math.random() * 100000));
  } catch (err) {
    console.warn("Live story generation failed, using labelled sample:", err);
    setPill(els.pillText, "Text API: unreachable — sample shown", false);
    renderStory(SAMPLE_STORY, topic, true);
    loadIllustration(topic, Math.floor(Math.random() * 100000));
  } finally {
    els.generate.disabled = false;
    els.generate.textContent = "📖 Tell me a story";
  }
}

// ---------- Narration ----------

function highlightSentence(i) {
  // Rebuild highlighting by wrapping sentences in spans on first use,
  // keeping the paragraph breaks (one <p> per paragraph).
  if (!els.text.dataset.sentencified) {
    els.text.innerHTML = "";
    let idx = 0;
    currentParagraphs.forEach((para) => {
      const p = document.createElement("p");
      para.forEach((s) => {
        const span = document.createElement("span");
        span.className = "sentence";
        span.dataset.idx = String(idx++);
        span.textContent = s + " ";
        p.appendChild(span);
      });
      els.text.appendChild(p);
    });
    els.text.dataset.sentencified = "1";
  }
  els.text.querySelectorAll(".sentence").forEach((sp) => {
    sp.classList.toggle("reading", Number(sp.dataset.idx) === i);
  });
  const active = els.text.querySelector(".sentence.reading");
  if (active) active.scrollIntoView({ behavior: "smooth", block: "center" });
  els.progress.hidden = false;
  els.progressBar.style.width = `${Math.round(((i + 1) / currentSentences.length) * 100)}%`;
}

function clearHighlight() {
  if (els.text.dataset.sentencified) {
    delete els.text.dataset.sentencified;
    els.text.querySelectorAll(".sentence").forEach((sp) => sp.classList.remove("reading"));
  }
  els.progress.hidden = true;
  els.progressBar.style.width = "0%";
}

function stopReading() {
  reading = false;
  if (visualTimer) { clearInterval(visualTimer); visualTimer = null; }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  els.read.disabled = false;
  els.stop.disabled = true;
  els.read.textContent = "▶️ Read aloud";
  els.narrateStatus.textContent = "Press “Read aloud” and the story will be spoken by your browser.";
  clearHighlight();
}

// Visual narration: used only when the browser has no speech voices.
// It is labelled as visual in the status line — never presented as audio.
function startVisualNarration() {
  reading = true;
  visualIndex = -1;
  els.read.disabled = true;
  els.stop.disabled = false;
  els.read.textContent = "▶️ Reading…";
  els.narrateStatus.textContent = "Visual narration — this browser has no speech voices, so sentences are highlighted as they are “read”. Audio narration works in desktop Chrome, Edge or Safari.";
  const step = () => {
    visualIndex += 1;
    if (visualIndex >= currentSentences.length || !reading) { stopReading(); return; }
    highlightSentence(visualIndex);
  };
  step();
  visualTimer = setInterval(step, 3200);
}

function startReading() {
  if (!currentSentences.length || reading) return;
  stopReading();
  const text = `${currentTitle}. ${currentSentences.join(" ")}`;
  const voices = ("speechSynthesis" in window) ? window.speechSynthesis.getVoices() : [];
  if (!voices.length) { startVisualNarration(); return; }

  const utter = new SpeechSynthesisUtterance(text);
  const chosen = voices.find((v) => v.name === els.voice.value) || voices[0];
  utter.voice = chosen;
  utter.rate = parseFloat(els.rate.value) || 1;
  utter.pitch = 1;
  let spoken = 0;
  utter.onboundary = (e) => {
    if (e.name === "sentence" || e.charIndex !== undefined) {
      // Map char offset to a sentence index.
      let total = 0;
      let idx = 0;
      for (let i = 0; i < currentSentences.length; i++) {
        total += currentSentences[i].length + 1;
        if (e.charIndex < total) { idx = i; break; }
        idx = i;
      }
      spoken = idx;
      highlightSentence(idx);
    }
  };
  utter.onend = () => { if (reading) stopReading(); };
  utter.onerror = (e) => {
    console.warn("Speech synthesis error, falling back to visual narration:", e);
    if (reading) startVisualNarration();
  };
  reading = true;
  els.read.disabled = true;
  els.stop.disabled = false;
  els.read.textContent = "▶️ Reading…";
  els.narrateStatus.textContent = `Reading aloud with ${chosen.name} — press Stop any time.`;
  highlightSentence(0);
  window.speechSynthesis.speak(utter);
}

// ---------- Wiring ----------

els.generate.addEventListener("click", onGenerate);
els.prompt.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onGenerate();
});
els.surprise.addEventListener("click", () => {
  const pick = SURPRISE_PROMPTS[Math.floor(Math.random() * SURPRISE_PROMPTS.length)];
  els.prompt.value = pick;
  clearError();
  els.prompt.focus();
});
els.read.addEventListener("click", startReading);
els.stop.addEventListener("click", stopReading);
els.rate.addEventListener("input", () => {
  els.rateValue.textContent = `${parseFloat(els.rate.value).toFixed(1)}×`;
});

initSpeech();
initMic();
