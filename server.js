// server.js
const express = require('express');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const Joi = require('joi');
const path = require('path');

// Configuración del servidor Express
const app = express();
const PORT = 3000; // Puedes cambiar el puerto si lo deseas

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Iniciar el servidor HTTP
const server = app.listen(PORT, () => {
  console.log(`Servidor HTTP corriendo en http://localhost:${PORT}`);
});

// Configurar el servidor WebSocket en el mismo servidor
const wss = new WebSocket.Server({ server });

// Esquema de validación usando Joi
const dataSchema = Joi.object({
  role: Joi.string().valid('user', 'dashboard').required(),
  screenWidth: Joi.number().optional(),
  screenHeight: Joi.number().optional(),
  cookiesEnabled: Joi.number().integer().min(0).max(1).optional(),
  browserInfo: Joi.string().optional(),
  os: Joi.string().valid('Windows', 'MacOS', 'iOS', 'Android', 'Windows Phone', 'Desconocido').optional(),
  deviceBrand: Joi.string().optional() // Añadido para la marca del dispositivo
});

// Conectar a MongoDB
const mongoClient = new MongoClient('mongodb://localhost:27017', { useUnifiedTopology: true });
let db;

mongoClient.connect()
  .then(() => {
    db = mongoClient.db('deviceData');
    console.log('Conectado a MongoDB');
  })
  .catch(err => {
    console.error('Error de conexión a MongoDB:', err);
    process.exit(1);
  });

// Función para calcular agregados
async function getAggregatedData() {
  const collection = db.collection('devices');

  // Total de dispositivos registrados (solo los que ingresaron a user.html)
  const totalUsers = await collection.countDocuments();

  // Resolución de pantalla
  const screenResolution = await collection.aggregate([
    {
      $group: {
        _id: { width: "$screenWidth", height: "$screenHeight" },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        resolution: { $concat: [{ $toString: "$_id.width" }, "x", { $toString: "$_id.height" }] },
        count: 1,
        _id: 0
      }
    }
  ]).toArray();

  // Cookies habilitadas
  const cookiesHabilitadas = await collection.aggregate([
    {
      $group: {
        _id: "$cookiesEnabled",
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        status: { $cond: [{ $eq: ["$_id", 1] }, "Habilitadas", "Deshabilitadas"] },
        count: 1,
        _id: 0
      }
    }
  ]).toArray();

  // Navegador y Versión
  const browserInfo = await collection.aggregate([
    {
      $group: {
        _id: "$browserInfo",
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        browser: "$_id",
        count: 1,
        _id: 0
      }
    }
  ]).toArray();

  // Sistema Operativo
  const osInfo = await collection.aggregate([
    {
      $group: {
        _id: "$os",
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        os: "$_id",
        count: 1,
        _id: 0
      }
    }
  ]).toArray();

  // Marca del Dispositivo
  const deviceBrandInfo = await collection.aggregate([
    {
      $group: {
        _id: "$deviceBrand",
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        brand: "$_id",
        count: 1,
        _id: 0
      }
    }
  ]).toArray();

  return {
    totalUsers,
    screenResolution,
    cookiesHabilitadas,
    browserInfo,
    osInfo,
    deviceBrandInfo
  };
}

wss.on('connection', ws => {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Validar los datos recibidos
      const { error, value } = dataSchema.validate(data);
      if (error) {
        console.error('Datos inválidos recibidos:', error.details);
        ws.send(JSON.stringify({ status: 'error', message: 'Datos inválidos' }));
        return;
      }

      if (value.role === 'dashboard') {
        // Cliente es dashboard, enviar datos agregados periódicamente
        console.log('Dashboard conectado');

        const sendAggregatedData = async () => {
          const aggregatedData = await getAggregatedData();
          ws.send(JSON.stringify(aggregatedData));
        };

        // Enviar datos inmediatamente y luego cada 5 segundos
        sendAggregatedData();
        const interval = setInterval(sendAggregatedData, 5000);

        ws.on('close', () => {
          console.log('Dashboard desconectado');
          clearInterval(interval);
        });

      } else if (value.role === 'user') {
        // Cliente es usuario (user.html), guardar los datos
        const userData = {
          screenWidth: value.screenWidth,
          screenHeight: value.screenHeight,
          cookiesEnabled: value.cookiesEnabled,
          browserInfo: value.browserInfo,
          os: value.os,
          deviceBrand: value.deviceBrand || 'Desconocido' // Guardar la marca del dispositivo
        };

        // Guardar en MongoDB
        const collection = db.collection('devices');
        await collection.insertOne(userData);
        console.log('Datos guardados en MongoDB:', userData);

        // Enviar confirmación al usuario
        ws.send(JSON.stringify({ status: 'success', message: 'Datos recibidos' }));
      }

    } catch (error) {
      console.error('Error al procesar el mensaje:', error);
      ws.send(JSON.stringify({ status: 'error', message: 'Error procesando los datos' }));
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
  });
});

console.log(`Servidor WebSocket y HTTP corriendo en http://localhost:${PORT}`);
