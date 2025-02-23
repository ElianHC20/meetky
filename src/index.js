const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Inicializar Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();
const app = express();
const clients = new Map();

app.use(cors());
app.use(express.json());

// Función para limpiar directorios de caché
async function clearCache(businessId) {
  const sessionDir = path.join(process.cwd(), `.wwebjs_auth/session-${businessId}`);
  const cacheDir = path.join(process.cwd(), '.wwebjs_cache');
  
  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
    await fs.rm(cacheDir, { recursive: true, force: true });
    console.log('Cache cleared successfully');
  } catch (error) {
    console.log('No cache to clear');
  }
}

async function getOrCreateClient(businessId) {
  if (!businessId) {
    throw new Error('BusinessId is required');
  }

  try {
    if (clients.has(businessId)) {
      return clients.get(businessId);
    }

    // Limpiar caché antes de crear nuevo cliente
    await clearCache(businessId);

    const client = new Client({
      authStrategy: new LocalAuth({ 
        clientId: `bot-${businessId}`,
        dataPath: path.join(process.cwd(), '.wwebjs_auth')
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-web-security'
        ]
      },
      webVersion: '2.2402.5'
    });

    client.on('qr', async (qr) => {
      try {
        const qrCode = await qrcode.toDataURL(qr);
        await db.collection('whatsappClients').doc(businessId).set({
          qr: qrCode,
          status: 'qr_received',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`QR Code generated for ${businessId}`);
      } catch (error) {
        console.error('Error saving QR:', error);
      }
    });

    client.on('ready', async () => {
      console.log(`Client ${businessId} is ready!`);
      await db.collection('whatsappClients').doc(businessId).set({
        status: 'connected',
        qr: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    client.on('disconnected', async (reason) => {
      console.log(`Client ${businessId} was disconnected:`, reason);
      await db.collection('whatsappClients').doc(businessId).set({
        status: 'disconnected',
        qr: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      clients.delete(businessId);
      await clearCache(businessId);
    });

    client.on('auth_failure', async (msg) => {
      console.log(`Auth failure for ${businessId}:`, msg);
      await db.collection('whatsappClients').doc(businessId).set({
        status: 'auth_failure',
        qr: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      clients.delete(businessId);
      await clearCache(businessId);
    });

    await client.initialize();
    clients.set(businessId, client);
    return client;
  } catch (error) {
    console.error(`Error initializing client ${businessId}:`, error);
    await clearCache(businessId);
    throw error;
  }
}

// Rutas
app.get('/status/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const doc = await db.collection('whatsappClients').doc(businessId).get();
    const data = doc.data() || { status: 'disconnected' };
    
    res.json({
      status: data.status,
      isConnected: data.status === 'connected'
    });
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.get('/qr/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const doc = await db.collection('whatsappClients').doc(businessId).get();
    const data = doc.data();

    if (data?.qr && data?.status === 'qr_received') {
      res.json({ qr: data.qr });
    } else {
      res.status(404).json({ error: 'QR not available' });
    }
  } catch (error) {
    console.error('Error getting QR:', error);
    res.status(500).json({ error: 'Failed to get QR' });
  }
});

app.post('/reset-connection/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    // Limpiar cliente existente si existe
    if (clients.has(businessId)) {
      const client = clients.get(businessId);
      await client.destroy();
      clients.delete(businessId);
    }
    
    // Limpiar caché
    await clearCache(businessId);
    
    // Iniciar nuevo cliente
    await getOrCreateClient(businessId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error resetting connection:', error);
    res.status(500).json({ error: 'Failed to reset connection' });
  }
});

app.post('/send-message/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message are required' });
    }

    const client = await getOrCreateClient(businessId);
    const formattedPhone = `${phone}@c.us`;
    await client.sendMessage(formattedPhone, message);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Manejador de errores global
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});