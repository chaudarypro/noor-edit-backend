require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createCanvas, registerFont, loadImage } = require('canvas');

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

// Génère une frame PNG pour un verset
async function generateFrame(settings, verseText, sourceText, dimensions, logoImage) {
  const { width, height } = dimensions;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // ── Fond ────────────────────────────────────────────────────────────────────
  if (settings.bgType === 'video') {
    // Fond transparent — la vidéo sera utilisée comme fond dans FFmpeg
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
  } else {
    ctx.fillStyle = settings.bgColor || '#001710';
    ctx.fillRect(0, 0, width, height);
  }

  // ── Texte arabe ──────────────────────────────────────────────────────────────
  if (settings.arabic?.show && verseText) {
    const fontSize = (settings.arabic.size || 8) / 100 * width;
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
    if (settings.translation?.show && settings.translationTexts) {
      const transFontSize = (settings.translation.size || 3) / 100 * width;
      ctx.font = `${transFontSize}px sans-serif`;
      ctx.fillStyle = settings.translation.color || '#ffffff';
      ctx.textAlign = 'center';
      ctx.direction = 'ltr';
      ctx.globalAlpha = 0.85;
      const transY = startY - fontSize + (settings.textGap || 2) / 100 * width;
      ctx.fillText(settings.translationTexts[0] || '', width / 2, transY);
      ctx.globalAlpha = 1;
      startY = transY + transFontSize * 1.6;
    }

    // ── Source du verset ───────────────────────────────────────────────────────
    if (settings.showSource && sourceText) {
      const sourceFontSize = (settings.sourceSize || 2) / 100 * width;
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

  // ── Watermark ─────────────────────────────────────────────────────────────────
  const wmType = settings.watermarkType || 'default';
  const isTop = settings.format === '16:9';

  if (wmType === 'text' && settings.watermarkText) {
    const fontSize = Math.round(width * 0.018);
    ctx.font = `700 ${fontSize}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.25;
    if (isTop) {
      const marginX = Math.round(width * 0.07);
      const marginY = Math.round(height * 0.08);
      ctx.textAlign = 'left';
      ctx.fillText(settings.watermarkText.toUpperCase(), marginX, marginY + fontSize);
    } else {
      const y = height - height * 0.16;
      ctx.textAlign = 'center';
      ctx.fillText(settings.watermarkText.toUpperCase(), width / 2, y);
    }
    ctx.globalAlpha = 1;
  } else {
    // Logo (custom base64 ou logo Quran Edit par défaut)
    let wmImage = logoImage;
    if (wmType === 'logo' && settings.watermarkLogoBase64) {
      try {
        const buf = Buffer.from(settings.watermarkLogoBase64, 'base64');
        wmImage = await loadImage(buf);
      } catch (e) {
        console.log('⚠️ Logo custom invalide, fallback logo par défaut');
      }
    }
    if (wmImage) {
      const logoSize = Math.round(width * 0.15);
      ctx.globalAlpha = 0.25;
      if (isTop) {
        const marginX = Math.round(width * 0.07);
        const marginY = Math.round(height * 0.08);
        ctx.drawImage(wmImage, marginX, marginY, logoSize, logoSize);
      } else {
        const x = (width - logoSize) / 2;
        const y = height - height * 0.16 - logoSize;
        ctx.drawImage(wmImage, x, y, logoSize, logoSize);
      }
      ctx.globalAlpha = 1;
    }
  }

  return canvas.toBuffer('image/png');
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

  // Charger le logo une seule fois
  let logoImage = null;
  try {
    logoImage = await loadImage(path.join(__dirname, '..', 'splashscreen.png'));
    console.log('✅ Logo watermark chargé');
  } catch (e) {
    console.log('⚠️ Logo watermark non trouvé, watermark désactivé');
  }

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

  // 3. Générer les frames pour chaque verset
  console.log('🖼 Génération des frames...');
  const framePaths = [];

  for (let i = 0; i < verses.length; i++) {
    const verseId = verses[i];
    const verseText = settings.verseTexts[i];
    const sourceText = `${surahName}\nVerset ${verseId}`;
    const duration = await getAudioDuration(audioPaths[i]);

    console.log(`  → Verset ${verseId}: durée ${duration.toFixed(2)}s`);

    const frameBuffer = await generateFrame(settings, verseText, sourceText, dimensions, logoImage);
    const framePath = path.join(tmpDir, `frame_${verseId}.png`);
    fs.writeFileSync(framePath, frameBuffer);

    framePaths.push({ framePath, duration, verseId });
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
  let bgVideoOffset = 0; // Pour enchaîner les segments de la vidéo de fond

  for (const { framePath, duration, verseId } of framePaths) {
    const clipPath = path.join(tmpDir, `clip_${verseId}.mp4`);

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
          .outputOptions([
            '-map', '[outv]',
            '-pix_fmt', 'yuv420p',
            '-r', '30',
            '-t', String(duration),
          ])
          .videoCodec('libx264')
          .output(clipPath)
          .on('end', () => { console.log(`  ✓ Clip verset ${verseId} créé (fond vidéo)`); resolve(); })
          .on('error', reject)
          .run();
      });
      bgVideoOffset += duration;
    } else {
      // Fond image/couleur classique
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(framePath)
          .inputOptions(['-loop', '1', '-t', String(duration)])
          .videoCodec('libx264')
          .outputOptions([
            '-pix_fmt', 'yuv420p',
            '-vf', `scale=${dimensions.width}:${dimensions.height}`,
            '-r', '30',
          ])
          .output(clipPath)
          .on('end', () => { console.log(`  ✓ Clip verset ${verseId} créé`); resolve(); })
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