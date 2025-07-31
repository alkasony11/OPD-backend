# Email Setup for OTP System

## Setup Steps

### 1. Enable 2-Factor Authentication on Gmail
1. Go to your Google Account: https://myaccount.google.com/
2. Click "Security"
3. Enable "2-Step Verification"

### 2. Generate App Password
1. Go to "App passwords" in Security
2. Select "Mail" and "Other (Custom name)"
3. Enter "Hospital OTP" as name
4. Click "Generate"
5. Copy the 16-character password

### 3. Create .env File
Create a `.env` file in the backend folder:
```env
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-16-character-app-password
```

### 4. Restart Backend
After creating the `.env` file, restart your backend server.

## Test the System
1. Start backend: `node src/index.js`
2. Start frontend: `npm run dev`
3. Go to registration page
4. Fill form and click "Send OTP & Continue"
5. Check your email for the OTP code 