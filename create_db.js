const { Client } = require('pg');
require('dotenv').config();

async function createDatabase() {
  // Connect to the default 'postgres' database first
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres', // Connect to default DB to create the new one
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL...');

    // Check if database exists
    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'doctor_db'`);
    
    if (res.rowCount === 0) {
      console.log("Creating database 'doctor_db'...");
      await client.query('CREATE DATABASE doctor_db');
      console.log("Database 'doctor_db' created successfully!");
    } else {
      console.log("Database 'doctor_db' already exists.");
    }
  } catch (err) {
    console.error('Error creating database:', err.message);
  } finally {
    await client.end();
  }
}

createDatabase();
