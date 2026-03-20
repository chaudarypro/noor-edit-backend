require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateVideo } = require('./generateVideo');
const { uploadVideo } = require('./uploadVideo');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'noor-edit-worker' });
});

app.post('/generate', async (req, res) => {
  const { settings, surahName, verses, jobId } = req.body;

  if (!settings || !verses || !jobId) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  console.log(`\n🎬 Nouveau job: ${jobId}`);
  console.log(`📖 ${surahName} — Versets ${verses.join(', ')}`);

  // Dossier temporaire pour ce job
  const tmpDir = path.join(os.tmpdir(), `noor-edit-${jobId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Générer la vidéo
    const videoPath = await generateVideo(settings, surahName, verses, tmpDir);

    // Uploader sur Cloudinary
    console.log('☁️ Upload sur Cloudinary...');
    const videoUrl = await uploadVideo(videoPath, `export_${jobId}`);

    // Nettoyer les fichiers temporaires
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log(`✅ Job ${jobId} terminé: ${videoUrl}`);
    res.json({ success: true, videoUrl });

  } catch (error) {
    console.error(`❌ Erreur job ${jobId}:`, error.message);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Noor Edit Worker démarré sur port ${PORT}`);
});