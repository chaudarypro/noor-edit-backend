require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createCanvas, registerFont } = require('canvas');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Enregistrer la police UthmanicHafs
try {
  registerFont('/app/UthmanicHafs_V22.ttf', { family: 'UthmanicHafs' });
  console.log('✅ Police UthmanicHafs chargée');
} catch (e) {
  console.log('⚠️ Police UthmanicHafs non trouvée, fallback serif');
}

// Dimensions selon le format
function getDimensions(format) {
  switch (format) {
    case '9:16': return { width: 1080, height: 1920 };
    case '1:1':  return { width: 1080, height: 1080 };
    case '16:9': return { width: 1920, height: 1080 };
    default:     return { width: 1080, height: 1920 };
  }
}

// Télécharge un MP3
async function downloadAudio(surahId, verseId, reciterId, destPath) {
  const s = String(surahId).padStart(3, '0');
  const a = String(verseId).padStart(3, '0');
  const url = `https://audio-cdn.tarteel.ai/quran/${reciterId}/${s}${a}.mp3`;
  console.log(`  → Téléchargement: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio non trouvé: ${url}`);
  const buffer = await res.buffer();
  fs.writeFileSync(destPath, buffer);
  console.log(`  ✓ Audio téléchargé: ${path.basename(destPath)}`);
}

// Concatène les MP3 en un seul fichier
async function concatAudio(audioPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const listPath = outputPath + '.txt';
    const listContent = audioPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .audioCodec('libmp3lame')
      .output(outputPath)
      .on('end', () => { fs.unlinkSync(listPath); resolve(); })
      .on('error', reject)
      .run();
  });
}

// Wrap text pour canvas
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const { width: testWidth } = ctx.measureText(testLine);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Génère une frame PNG — verseText peut être un chunk de mots, translationText est la traduction complète du verset
function generateFrame(settings, verseText, sourceText, dimensions, translationText) {
  const { width, height } = dimensions;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const scale = width / (settings.previewW || 400);

  // ── Fond ────────────────────────────────────────────────────────────────────
  if (settings.bgType === 'video') {
    ctx.clearRect(0, 0, width, height);
  } else if (settings.bgType === 'gradient') {
    const angle = ((settings.gradientAngle || 135) - 90) * Math.PI / 180;
    const x1 = width / 2 - Math.cos(angle) * width / 2;
    const y1 = height / 2 - Math.sin(angle) * height / 2;
    const x2 = width / 2 + Math.cos(angle) * width / 2;
    const y2 = height / 2 + Math.sin(angle) * height / 2;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, settings.gradientFrom || '#001710');
    grad.addColorStop(1, settings.gradientTo || '#053025');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = settings.bgColor || '#001710';
    ctx.fillRect(0, 0, width, height);
  }

  // ── Texte arabe ──────────────────────────────────────────────────────────────
  if (settings.arabic?.show && verseText) {
    const fontSize = (settings.arabic.size || 22) * scale;
    ctx.font = `${fontSize}px UthmanicHafs, serif`;
    ctx.fillStyle = settings.arabic.color || '#ffffff';
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';

    const maxWidth = width - 160;
    const lines = wrapText(ctx, verseText, maxWidth);
    const lineHeight = fontSize * 2.2;
    const totalTextHeight = lines.length * lineHeight;
    let startY = (height - totalTextHeight) / 2 + fontSize;

    for (const line of lines) {
      ctx.fillText(line, width / 2, startY);
      startY += lineHeight;
    }

    // ── Traduction ─────────────────────────────────────────────────────────────
    if (settings.translation?.show && translationText) {
      const transFontSize = (settings.translation.size || 10) * scale;
      ctx.font = `${transFontSize}px sans-serif`;
      ctx.fillStyle = settings.translation.color || '#ffffff';
      ctx.textAlign = 'center';
      ctx.direction = 'ltr';
      ctx.globalAlpha = 0.85;
      const transY = startY + (settings.textGap || 16) * scale;
      ctx.fillText(translationText, width / 2, transY);
      ctx.globalAlpha = 1;
      startY = transY + transFontSize * 1.6;
    }

    // ── Source du verset ───────────────────────────────────────────────────────
    if (settings.showSource && sourceText) {
      const sourceFontSize = (settings.sourceSize || 5) * scale * 3;
      ctx.font = `${sourceFontSize}px sans-serif`;
      ctx.fillStyle = '#89938d';
      ctx.textAlign = 'center';
      ctx.direction = 'ltr';

      const sourceLines = sourceText.split('\n');
      let sourceY = settings.sourcePosition === 'top'
        ? (height - totalTextHeight) / 2 - sourceFontSize * 2
        : startY + 40;

      for (const line of sourceLines) {
        ctx.fillText(line.toUpperCase(), width / 2, sourceY);
        sourceY += sourceFontSize * 1.8;
      }
    }
  }

  // ── Watermark ────────────────────────────────────────────────────────────────
  ctx.font = `${width * 0.018}px sans-serif`;
  ctx.fillStyle = 'rgba(193, 236, 219, 0.25)';
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.globalAlpha = 0.25;
  ctx.fillText('✦ NOOR EDIT', 30, height - 30);
  ctx.globalAlpha = 1;

  return canvas.toBuffer('image/png');
}

// Découpe un verset en chunks de mots avec leurs timings
function buildWordChunks(verseText, segments, audioDuration, chunkSize = 5) {
  const words = verseText.split(' ').filter(Boolean);
  const totalMs = audioDuration * 1000;
  const chunks = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunkWords = words.slice(i, i + chunkSize);
    const firstSeg = segments.find(s => s.wordIndex === i);
    const nextSeg  = i + chunkSize < words.length ? segments.find(s => s.wordIndex === i + chunkSize) : null;

    // Si les segments manquent, on répartit le temps équitablement
    const startMs = i === 0 ? 0 : (firstSeg ? firstSeg.startMs : (i / words.length) * totalMs);
    const endMs   = nextSeg ? nextSeg.startMs : totalMs;
    const duration = Math.max(0.1, (endMs - startMs) / 1000);

    chunks.push({ text: chunkWords.join(' '), startMs, endMs, duration });
  }
  return chunks;
}

// Crée un clip vidéo mot-par-mot pour un verset (fond couleur/gradient)
async function generateWordByWordClip(settings, verseText, translationText, sourceText, dimensions, audioDuration, segments, tmpDir, verseId) {
  const chunks = buildWordChunks(verseText, segments, audioDuration);
  const chunkClipPaths = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const frameBuffer = generateFrame(settings, chunk.text, sourceText, dimensions, translationText);
    const framePath = path.join(tmpDir, `frame_${verseId}_c${ci}.png`);
    fs.writeFileSync(framePath, frameBuffer);

    const chunkClipPath = path.join(tmpDir, `clip_${verseId}_c${ci}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(framePath)
        .inputOptions(['-loop', '1', '-t', String(chunk.duration)])
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt', 'yuv420p', '-vf', `scale=${dimensions.width}:${dimensions.height}`, '-r', '30'])
        .output(chunkClipPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    chunkClipPaths.push(chunkClipPath);
  }

  // Concaténer tous les chunks en un seul clip de verset
  const verseClipPath = path.join(tmpDir, `verseclip_${verseId}.mp4`);
  if (chunkClipPaths.length === 1) {
    fs.copyFileSync(chunkClipPaths[0], verseClipPath);
  } else {
    const listPath = path.join(tmpDir, `chunks_${verseId}.txt`);
    fs.writeFileSync(listPath, chunkClipPaths.map(p => `file '${p}'`).join('\n'));
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('copy')
        .output(verseClipPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }
  return verseClipPath;
}

// Durée d'un fichier audio
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });
}

// Télécharge la vidéo de fond Pexels
async function downloadBgVideo(url, destPath) {
  console.log(`  → Téléchargement vidéo de fond: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Vidéo de fond non trouvée: ${url}`);
  const buffer = await res.buffer();
  fs.writeFileSync(destPath, buffer);
  console.log(`  ✓ Vidéo de fond téléchargée`);
}

// Génère la vidéo complète
async function generateVideo(settings, surahName, verses, tmpDir) {
  const dimensions = getDimensions(settings.format);

  // 1. Télécharger tous les audios
  console.log('📥 Téléchargement des audios...');
  const audioPaths = [];
  for (const verseId of verses) {
    const audioPath = path.join(tmpDir, `audio_${verseId}.mp3`);
    await downloadAudio(settings.surahId, verseId, settings.reciterId, audioPath);
    audioPaths.push(audioPath);
  }

  // 2. Concaténer les audios
  console.log('🔗 Concaténation des audios...');
  const combinedAudioPath = path.join(tmpDir, 'combined.mp3');
  if (audioPaths.length === 1) {
    fs.copyFileSync(audioPaths[0], combinedAudioPath);
  } else {
    await concatAudio(audioPaths, combinedAudioPath);
  }

  // 3. Générer les frames / clips pour chaque verset
  console.log('🖼 Génération des frames...');
  const framePaths = [];

  for (let i = 0; i < verses.length; i++) {
    const verseId = verses[i];
    const verseText = settings.verseTexts[i];
    const translationText = (settings.translationTexts && settings.translationTexts[i]) || '';
    const sourceText = `${surahName}\nVerset ${verseId}`;
    const duration = await getAudioDuration(audioPaths[i]);
    const segments = (settings.verseSegments && settings.verseSegments[i]) || [];

    console.log(`  → Verset ${verseId}: durée ${duration.toFixed(2)}s, ${segments.length} segments`);

    // Mot-par-mot si segments disponibles et fond non-vidéo (simplification)
    if (segments.length > 0 && settings.bgType !== 'video') {
      console.log(`  → Mode mot-par-mot (${Math.ceil(verseText.split(' ').length / 5)} chunks)`);
      const verseClipPath = await generateWordByWordClip(
        settings, verseText, translationText, sourceText, dimensions, duration, segments, tmpDir, verseId
      );
      framePaths.push({ framePath: null, verseClipPath, duration, verseId });
    } else {
      const frameBuffer = generateFrame(settings, verseText, sourceText, dimensions, translationText);
      const framePath = path.join(tmpDir, `frame_${verseId}.png`);
      fs.writeFileSync(framePath, frameBuffer);
      framePaths.push({ framePath, verseClipPath: null, duration, verseId });
    }
  }

  // 3.5 Télécharger la vidéo de fond si nécessaire
  let bgVideoPath = null;
  if (settings.bgType === 'video' && settings.bgVideoUri) {
    bgVideoPath = path.join(tmpDir, 'bg_video.mp4');
    await downloadBgVideo(settings.bgVideoUri, bgVideoPath);
  }

  // 4. Créer un clip vidéo par verset
  console.log('🎬 Création des clips vidéo...');
  const clipPaths = [];
  let bgVideoOffset = 0;

  for (const { framePath, verseClipPath, duration, verseId } of framePaths) {
    const clipPath = path.join(tmpDir, `clip_${verseId}.mp4`);

    // Si le clip mot-par-mot est déjà généré, l'utiliser directement
    if (verseClipPath) {
      fs.copyFileSync(verseClipPath, clipPath);
      console.log(`  ✓ Clip verset ${verseId} (mot-par-mot)`);
      clipPaths.push(clipPath);
      continue;
    }

    if (bgVideoPath) {
      // Fond vidéo : overlay du texte sur la vidéo Pexels
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(bgVideoPath)
          .inputOptions(['-ss', String(bgVideoOffset), '-t', String(duration)])
          .input(framePath)
          .complexFilter([
            `[0:v]scale=${dimensions.width}:${dimensions.height},setsar=1[bg]`,
            `color=black@${settings.bgOverlayOpacity || 0.5}:${dimensions.width}x${dimensions.height},format=rgba[blackoverlay]`,
            `[bg][blackoverlay]overlay=0:0[darkbg]`,
            `[1:v]scale=${dimensions.width}:${dimensions.height},format=rgba[text]`,
            `[darkbg][text]overlay=0:0[outv]`,
          ])
          .outputOptions(['-map', '[outv]', '-pix_fmt', 'yuv420p', '-r', '30', '-t', String(duration)])
          .videoCodec('libx264')
          .output(clipPath)
          .on('end', () => { console.log(`  ✓ Clip verset ${verseId} (fond vidéo)`); resolve(); })
          .on('error', reject)
          .run();
      });
      bgVideoOffset += duration;
    } else {
      // Fond couleur/gradient classique
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(framePath)
          .inputOptions(['-loop', '1', '-t', String(duration)])
          .videoCodec('libx264')
          .outputOptions(['-pix_fmt', 'yuv420p', '-vf', `scale=${dimensions.width}:${dimensions.height}`, '-r', '30'])
          .output(clipPath)
          .on('end', () => { console.log(`  ✓ Clip verset ${verseId}`); resolve(); })
          .on('error', reject)
          .run();
      });
    }

    clipPaths.push(clipPath);
  }

  // 5. Concaténer les clips vidéo
  console.log('🔗 Assemblage de la vidéo...');
  const videoOnlyPath = path.join(tmpDir, 'video_only.mp4');
  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], videoOnlyPath);
  } else {
    const listPath = path.join(tmpDir, 'clips.txt');
    fs.writeFileSync(listPath, clipPaths.map(p => `file '${p}'`).join('\n'));
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('copy')
        .output(videoOnlyPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  // 6. Mixer vidéo + audio
  console.log('🎵 Mixage audio/vidéo...');
  const finalPath = path.join(tmpDir, 'final.mp4');
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoOnlyPath)
      .input(combinedAudioPath)
      .videoCodec('copy')
      .audioCodec('aac')
      .outputOptions(['-shortest', '-map', '0:v:0', '-map', '1:a:0'])
      .output(finalPath)
      .on('end', () => { console.log('  ✓ Mixage terminé'); resolve(); })
      .on('error', reject)
      .run();
  });

  console.log('✅ Vidéo générée !');
  return finalPath;
}

module.exports = { generateVideo };