// src/db/index.js
const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const sequelize = require('../config/database');

const db = {};

// --- 1. Read all model files from the /api directory ---
const apiDir = path.join(__dirname, '../api');

fs.readdirSync(apiDir)
  .forEach(moduleDir => {
    const modulePath = path.join(apiDir, moduleDir);
    // Check if it's a directory
    if (fs.statSync(modulePath).isDirectory()) {
      // Look for a .model.js file inside the directory
      const modelFile = fs.readdirSync(modulePath).find(file => file.endsWith('.model.js'));
      if (modelFile) {
        const model = require(path.join(modulePath, modelFile));
        db[model.name] = model;
      }
    }
  });

// --- 2. Call the 'associate' method on each model ---
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// --- 3. Export the db object ---
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;