const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream/promises');
const config = require('./config');

const MIME_EXTENSION_MAP = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/plain': '.txt'
};

function getTempDir() {
  const resolvedTempDir = path.resolve(config.tempDir || '/tmp');
  fs.mkdirSync(resolvedTempDir, { recursive: true });
  return resolvedTempDir;
}

function sanitizeFilename(filenameHint) {
  const rawName = String(filenameHint || '').trim();
  const safeName = path
    .basename(rawName || 'wa-media')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');

  return safeName || 'wa-media';
}

function ensureExtension(filename, mimeType = '') {
  const parsed = path.parse(filename);

  if (parsed.ext) {
    return filename;
  }

  const extension = MIME_EXTENSION_MAP[mimeType] || '';
  return `${filename}${extension}`;
}

function buildTempFilePath(filenameHint) {
  const safeFilename = sanitizeFilename(filenameHint);
  const parsed = path.parse(safeFilename);
  const stampedName = `${parsed.name}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}${parsed.ext}`;

  return path.join(getTempDir(), stampedName);
}

async function getMediaMeta(mediaId) {
  if (!mediaId) {
    throw new Error('mediaId is required');
  }

  if (!config.whatsappToken) {
    throw new Error('WHATSAPP_TOKEN is not configured');
  }

  const url = `https://graph.facebook.com/v23.0/${encodeURIComponent(mediaId)}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`
    },
    timeout: 15000
  });

  return {
    mediaId,
    url: response.data?.url || '',
    mime: response.data?.mime_type || '',
    mimeType: response.data?.mime_type || '',
    sha256: response.data?.sha256 || '',
    fileSize: response.data?.file_size || null
  };
}

async function downloadMediaToTemp(url, filenameHint) {
  if (!url) {
    throw new Error('url is required to download media');
  }

  if (!config.whatsappToken) {
    throw new Error('WHATSAPP_TOKEN is not configured');
  }

  const filePath = buildTempFilePath(filenameHint);
  const response = await axios.get(url, {
    responseType: 'stream',
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`
    },
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  const contentType = response.headers['content-type'] || '';
  const finalFilePath = ensureExtension(filePath, contentType);
  let downloadedBytes = 0;

  response.data.on('data', (chunk) => {
    downloadedBytes += chunk.length;
  });

  try {
    await pipeline(response.data, fs.createWriteStream(finalFilePath));
    const stats = await fsp.stat(finalFilePath);

    return {
      filePath: finalFilePath,
      filename: path.basename(finalFilePath),
      size: downloadedBytes || stats.size
    };
  } catch (error) {
    await fsp.unlink(finalFilePath).catch(() => {});
    throw error;
  }
}

module.exports = {
  getMediaMeta,
  downloadMediaToTemp
};
