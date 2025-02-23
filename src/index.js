const express = require('express');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const admin = require('firebase-admin');
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

async function initializeClient(businessId) {
  try {
    const client = new Client({
      puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920x1080',
          '--remote-debugging-port=9222'
        ]
      },
      webVersionCache: {
        type: 'none'
      },
      webVersion: '2.2402.5',
      restartOnAuthFail: true
    });

    client.on('qr', async (qr) => {
      try {
        console.log('QR Code received');
        const qrCode = await qrcode.toDataURL(qr);
        await db.collection('whatsappClients').doc(businessId).set({
          qr: qrCode,
          status: 'qr_received',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: null
        });
      } catch (error) {
        console.error('Error saving QR:', error);
      }
    });

    client.on('ready', async () => {
      console.log('Client is ready!');
      await db.collection('whatsappClients').doc(businessId).set({
        status: 'connected',
        qr: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        error: null
      });
    });

    client.on('disconnected', async (reason) => {
      console.log('Client was disconnected:', reason);
      await db.collection('whatsappClients').doc(businessId).set({
        status: 'disconnected',
        error: reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      clients.delete(businessId);
    });

    client.on('auth_failure', async (msg) => {
      console.log('Auth failure:', msg);
      await db.collection('whatsappClients').doc(businessId).set({
        status: 'auth_failure',
        error: msg,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await client.initialize();
    clients.set(businessId, client);
    return client;
  } catch (error) {
    console.error('Error initializing client:', error);
    await db.collection('whatsappClients').doc(businessId).set({
      status: 'error',
      error: error.message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    throw error;
  }
}

// Status endpoint
app.get('/status/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const doc = await db.collection('whatsappClients').doc(businessId).get();
    const data = doc.data() || { status: 'disconnected' };
    
    res.json({
      status: data.status,
      isConnected: data.status === 'connected',
      error: data.error
    });
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: error.message });
  }
});

// QR endpoint
app.get('/qr/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const doc = await db.collection('whatsappClients').doc(businessId).get();
    const data = doc.data();

    if (data?.qr && data.status === 'qr_received') {
      res.json({ qr: data.qr });
    } else {
      res.status(404).json({ error: 'QR not available' });
    }
  } catch (error) {
    console.error('Error getting QR:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset connection endpoint
app.post('/reset-connection/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    // Destroy existing client if it exists
    if (clients.has(businessId)) {
      const client = clients.get(businessId);
      await client.destroy();
      clients.delete(businessId);
    }
    
    await db.collection('whatsappClients').doc(businessId).set({
      status: 'initializing',
      qr: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await initializeClient(businessId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error resetting connection:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send message endpoint
app.post('/send-message/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message are required' });
    }

    let client = clients.get(businessId);
    if (!client) {
      client = await initializeClient(businessId);
    }

    await client.sendMessage(`${phone}@c.us`, message);
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});