require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));
app.use(passport.initialize());
app.use(passport.session());

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Cloud Dupe Cleaner backend is running' });
});

// Placeholder for cloud connection status
app.get('/api/connections', (req, res) => {
  res.json({
    dropbox: false,
    onedrive: false,
    googleDrive: false,
    googlePhotos: false
  });
});

app.listen(PORT, () => {
  console.log(`Cloud Dupe Cleaner backend running on http://localhost:${PORT}`);
});
