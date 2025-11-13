

const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());



const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI, {
}).then(() => {
  console.log('✓ Connected to MongoDB');
}).catch(err => {
  console.error('✗ MongoDB connection error:', err);
});


const gpsDataSchema = new mongoose.Schema({
  device_id: { type: String, required: true, index: true },
  timestamp: { type: Date, required: true, index: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  altitude: Number,
  speed: Number,
  satellites: Number,
  hdop: Number,
  created_at: { type: Date, default: Date.now }
});

const GPSData = mongoose.model('GPSData', gpsDataSchema);


app.post('/api/gps', async (req, res) => {
  try {
    console.log('📍 Received GPS data:', req.body);
    
    const gpsData = new GPSData({
      device_id: req.body.device_id,
      timestamp: req.body.timestamp || new Date(),
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      altitude: req.body.altitude,
      speed: req.body.speed,
      satellites: req.body.satellites,
      hdop: req.body.hdop
    });
    
    await gpsData.save();
    console.log('✓ Data saved to MongoDB');
    
    broadcastToClients({
      type: 'gps_update',
      data: gpsData
    });
    
    res.status(200).json({ 
      success: true, 
      message: 'GPS data received',
      id: gpsData._id 
    });
  } catch (error) {
    console.error('✗ Error saving GPS data:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/gps/latest/:device_id', async (req, res) => {
  try {
    const latestData = await GPSData
      .findOne({ device_id: req.params.device_id })
      .sort({ timestamp: -1 });
    
    if (!latestData) {
      return res.status(404).json({ 
        success: false, 
        message: 'No data found for this device' 
      });
    }
    
    res.json({ success: true, data: latestData });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/gps/history/:device_id', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const startDate = req.query.start ? new Date(req.query.start) : null;
    const endDate = req.query.end ? new Date(req.query.end) : null;
    
    let query = { device_id: req.params.device_id };
    
    if (startDate && endDate) {
      query.timestamp = { $gte: startDate, $lte: endDate };
    }
    
    const history = await GPSData
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit);
    
    res.json({ success: true, count: history.length, data: history });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});


app.get('/api/devices', async (req, res) => {
  try {
    const devices = await GPSData.distinct('device_id');
    res.json({ success: true, devices });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});


app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Start HTTP Server
const server = app.listen(PORT, () => {
  console.log(`🚀 HTTP Server running on port ${PORT}`);
  console.log(`📡 GPS endpoint: http://localhost:${PORT}/api/gps`);
});

// WebSocket Server for real-time updates
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('👤 New WebSocket client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 Received from client:', data);
      
      // Handle client requests (e.g., subscribe to specific device)
      if (data.action === 'subscribe' && data.device_id) {
        ws.device_id = data.device_id;
        ws.send(JSON.stringify({ 
          type: 'subscribed', 
          device_id: data.device_id 
        }));
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('👤 Client disconnected');
  });
  
  // Send initial connection message
  ws.send(JSON.stringify({ 
    type: 'connected', 
    message: 'WebSocket connection established' 
  }));
});

// Broadcast function
function broadcastToClients(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // If client is subscribed to a specific device, only send that device's data
      if (!client.device_id || client.device_id === data.data.device_id) {
        client.send(JSON.stringify(data));
      }
    }
  });
}

console.log('📡 WebSocket server ready');
console.log(`🔌 Connect to: ws://localhost:${PORT}`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await mongoose.connection.close();
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});