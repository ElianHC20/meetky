const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
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

// Función para obtener o crear un cliente de WhatsApp
async function getOrCreateClient(businessId) {
  if (!businessId) {
    throw new Error('BusinessId is required');
  }

  if (clients.has(businessId)) {
    return clients.get(businessId);
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `bot-${businessId}` }),
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
        '--disable-gpu'
      ]
    }
  });

  client.on('qr', async (qr) => {
    try {
      const qrCode = await qrcode.toDataURL(qr);
      await db.collection('whatsappClients').doc(businessId).set({
        qr: qrCode,
        status: 'qr_received',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
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
  });

  try {
    await client.initialize();
    clients.set(businessId, client);
  } catch (error) {
    console.error(`Error initializing client ${businessId}:`, error);
    throw error;
  }

  return client;
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
    const client = await getOrCreateClient(businessId);
    
    if (client) {
      clients.delete(businessId);
      await client.destroy();
    }
    
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

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});