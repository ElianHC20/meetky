const express = require('express');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

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
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    client.on('qr', async (qr) => {
      try {
        const qrCode = await qrcode.toDataURL(qr);
        await db.collection('whatsappClients').doc(businessId).set({
          qr: qrCode,
          status: 'qr_received',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('QR Generated for:', businessId);
      } catch (error) {
        console.error('Error saving QR:', error);
      }
    });

    client.on('ready', async () => {
      console.log('Client Ready:', businessId);
      await db.collection('whatsappClients').doc(businessId).set({
        status: 'connected',
        qr: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    client.on('disconnected', async () => {
      console.log('Client Disconnected:', businessId);
      clients.delete(businessId);
      await db.collection('whatsappClients').doc(businessId).set({
        status: 'disconnected',
        qr: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await client.initialize();
    clients.set(businessId, client);
    return client;
  } catch (error) {
    console.error('Error initializing client:', error);
    throw error;
  }
}

app.get('/status/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const doc = await db.collection('whatsappClients').doc(businessId).get();
    res.json(doc.data() || { status: 'disconnected' });
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
    
    if (data?.qr && data.status === 'qr_received') {
      res.json({ qr: data.qr });
    } else {
      res.status(404).json({ error: 'QR not available' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get QR' });
  }
});

app.post('/reset-connection/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    if (clients.has(businessId)) {
      const client = clients.get(businessId);
      await client.destroy();
      clients.delete(businessId);
    }
    
    await initializeClient(businessId);
    res.json({ success: true });
  } catch (error) {
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

    let client = clients.get(businessId);
    if (!client) {
      client = await initializeClient(businessId);
    }

    await client.sendMessage(`${phone}@c.us`, message);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});