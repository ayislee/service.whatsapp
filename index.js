const express = require('express');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, Buttons } = require('whatsapp-web.js');
const cors = require("cors");
const axios = require('axios');
const morgan = require('morgan');
const rfs = require('rotating-file-stream');
const moment = require('moment-timezone');
require('dotenv').config();
const app = express();

// Utility function untuk delay yang benar
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Buat direktori logs jika belum ada
const logDirectory = path.join(__dirname, 'logs');
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

// Buat rotating write stream
const accessLogStream = rfs.createStream('access.log', {
    interval: '1d', // rotasi harian
    path: logDirectory
});

// Buat format log kustom
morgan.token('date', (req, res, tz) => {
    return moment().tz(tz).format('YYYY-MM-DD HH:mm:ss');
});

// Gunakan morgan untuk mencatat log ke file dengan format kustom
app.use(morgan(':remote-addr - :remote-user [:date[Asia/Jakarta]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', { stream: accessLogStream }));

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const port = process.env.PORT;
const api_services_url = process.env.API_SERVICE_URL;
const service = process.env.SERVICE;

let sessionData;
let client;
let localauth

function getFrom(source) {

}

async function initializeWA() {
    try {
        if (client) {
            await client.destroy();
            client = null;
        }

        localauth = new LocalAuth({
            clientId: 'whatsapp-client',
            dataPath: path.join(__dirname, '.wwebjs_auth')
        });

        client = new Client({
            authStrategy: localauth,
            restartOnAuthFail: true,
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
                timeout: 100000,
                browserWSEndpoint: null
            }
        });

        // Event Handlers
        client.on('qr', (qr) => {
            console.log('QR RECEIVED', qr);
            qrcode.generate(qr, { small: true });
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] QR CODE GENERATED\n`);
        });

        client.on('ready', () => {
            console.log('Client is ready!');
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] CLIENT READY\n`);
        });

        client.on('authenticated', () => {
            console.log('Client is authenticated!');
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] CLIENT AUTHENTICATED\n`);
        });

        client.on('auth_failure', (msg) => {
            console.error('Authentication failure:', msg);
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] AUTH FAILURE: ${msg}\n`);
        });

        client.on('disconnected', async (reason) => {
            console.log('Client disconnected:', reason);
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] DISCONNECTED: ${reason}\n`);

            try {
                // Bersihkan session yang ada
                if (client) {
                    await client.destroy();
                    client = null;
                }

                // Hapus file session jika logout
                if (reason === 'LOGOUT') {
                    const authPath = path.join(__dirname, '.wwebjs_auth');
                    if (fs.existsSync(authPath)) {
                        fs.rmSync(authPath, { recursive: true, force: true });
                        console.log('Auth folder deleted');
                    }
                }

                // Tunggu sebentar sebelum reconnect
                await sleep(5000);
                
                // Coba inisialisasi ulang
                console.log('Attempting to reconnect...');
                await initializeWA();

            } catch (error) {
                console.error('Reconnection error:', error);
                fs.appendFileSync(path.join(logDirectory, 'access.log'),
                    `[${moment().format('YYYY-MM-DD HH:mm:ss')}] RECONNECTION ERROR: ${error.message}\n`);
            }
        });

        // Initialize client
        await client.initialize();

        return true;

    } catch (error) {
        console.error('Initialization error:', error);
        fs.appendFileSync(path.join(logDirectory, 'access.log'),
            `[${moment().format('YYYY-MM-DD HH:mm:ss')}] INIT ERROR: ${error.message}\n`);
        
        // Tunggu 30 detik sebelum mencoba lagi
        await sleep(30000);
        return initializeWA();
    }
}

function initializeHTTP(c) {
    app.get('/', (req, res, next) => {
        res.send('Welcome Whatsapp services');
    });

    app.get('/status', async (req, res, next) => {
        // console.log('get status')
        try {
            const status = await client.getState()
            return res.status(200).send({
                status: true,
                message: status
            })
        } catch (error) {
            // const status = await client.getState()
            return res.status(200).send({
                status: false,
                message: error.message
            })
        }
    })

    app.get('/connect', async (req, res, next) => {
        // Jika status serkarang sedang terkoneksi jgn lakukan ini 
        try {
            const status = await client.getState()
            if (status === 'CONNECTED') {

                return res.status(200).send({
                    status: false,
                    messaga: "Service already connected"
                })
            } else {
                initializeWA();
                return res.status(200).send({
                    status: true,
                    messaga: "Service Restarted"
                })
            }
        } catch (error) {
            initializeWA();
            return res.status(200).send({
                status: true,
                messaga: "Service Restarted"
            })
        }


    });

    // Endpoint /sendmessage - SIMPLIFIED VERSION
    app.post('/sendmessage', async (req, res) => {
        const { to, message } = req.body;

        console.log('\n📨 === REQUEST PESAN BARU ===');
        console.log('Ke:', to);
        console.log('Pesan:', message.substring(0, 100));

        // Validasi input
        if (!to || !message) {
            console.log('❌ Validasi gagal: input tidak lengkap');
            return res.status(400).json({
                status: false,
                message: 'Nomor tujuan dan pesan harus diisi'
            });
        }

        // Format nomor
        let formattedNumber = to.replace(/[^0-9]/g, '');
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.slice(1);
        } else if (!formattedNumber.startsWith('62')) {
            formattedNumber = '62' + formattedNumber;
        }
        formattedNumber = formattedNumber + '@c.us';
        console.log('📱 Nomor terformat:', formattedNumber);

        try {
            // Gunakan timeout global 2 menit
            const sendPromise = sendWhatsAppMessage(formattedNumber, message);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout 120 detik')), 120000)
            );

            const result = await Promise.race([sendPromise, timeoutPromise]);

            console.log('✓ Message sent successfully');
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] ✓ SENT TO ${formattedNumber}\n`);

            return res.status(200).json({
                status: true,
                message: 'Pesan terkirim',
                data: result
            });

        } catch (error) {
            console.error('❌ Error:', error.message);
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] ❌ ERROR: ${error.message}\n`);

            return res.status(500).json({
                status: false,
                message: `Gagal mengirim pesan: ${error.message}`
            });
        }
    });

    app.listen(port, () => {
        fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] [INFO] listening to port ${port}\n`);
        console.log('listening to port', port);
    });
}

// Message queue untuk menghindari race condition
const messageQueue = [];
let isProcessingQueue = false;

// Process message queue
async function processMessageQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    
    isProcessingQueue = true;
    
    while (messageQueue.length > 0) {
        const { to, message, resolve, reject } = messageQueue.shift();
        
        try {
            console.log(`\n📨 Processing dari queue: ${to}`);
            const result = await sendWhatsAppMessageDirect(to, message);
            resolve(result);
        } catch (error) {
            console.error(`❌ Queue processing error untuk ${to}:`, error.message);
            reject(error);
        }
        
        // Delay antar pesan dari queue
        if (messageQueue.length > 0) {
            console.log('⏳ Delay 5 detik sebelum pesan berikutnya...');
            await sleep(5000);
        }
    }
    
    isProcessingQueue = false;
}

// Modify the sendWhatsAppMessage function - menggunakan queue
async function sendWhatsAppMessage(to, message) {
    return new Promise((resolve, reject) => {
        messageQueue.push({ to, message, resolve, reject });
        processMessageQueue().catch(err => console.error('Queue error:', err));
    });
}

// Direct send dengan method alternatif
async function sendWhatsAppMessageDirect(to, message) {
    if (!client) {
        throw new Error('Client WhatsApp belum terinisialisasi');
    }

    try {
        // Cek koneksi
        console.log('✓ Mengecek koneksi WhatsApp...');
        const state = await client.getState();
        console.log('WhatsApp state:', state);
        
        if (state !== 'CONNECTED') {
            throw new Error(`WhatsApp tidak terhubung, state: ${state}`);
        }
        
        // Tunggu sebentar untuk stabilisasi
        console.log('⏳ Stabilisasi koneksi (3 detik)...');
        await sleep(3000);

        // Format nomor
        const chatId = to.includes('@') ? to : to + '@c.us';
        console.log('📱 Target chat:', chatId);

        // Coba Method 1: Kirim langsung
        console.log('📤 Method 1: Kirim pesan langsung...');
        try {
            const result = await Promise.race([
                client.sendMessage(chatId, message),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('sendMessage timeout 30s')), 30000)
                )
            ]);
            
            console.log('✓ Pesan berhasil dikirim!');
            console.log('ID Pesan:', result.id || result._id || 'unknown');
            return result;
        } catch (error1) {
            console.warn('⚠️  Method 1 gagal:', error1.message);
            
            // Coba Method 2: Cek chat dulu, baru kirim
            console.log('\n📤 Method 2: Cek chat terlebih dahulu...');
            try {
                // Dapatkan chat object
                const chat = await client.getChatById(chatId);
                console.log('✓ Chat ditemukan');
                
                // Kirim dari chat object
                const result = await Promise.race([
                    chat.sendMessage(message),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('chat.sendMessage timeout 30s')), 30000)
                    )
                ]);
                
                console.log('✓ Pesan berhasil dikirim via chat object!');
                console.log('ID Pesan:', result.id || result._id || 'unknown');
                return result;
            } catch (error2) {
                console.warn('⚠️  Method 2 gagal:', error2.message);
                
                // Coba Method 3: Via WebAPI dengan minimal checking
                console.log('\n📤 Method 3: Kirim dengan minimal checking...');
                try {
                    const result = await client.sendMessage(chatId, message, { 
                        mentions: [],
                        quotedMessageId: null 
                    });
                    
                    console.log('✓ Pesan berhasil dikirim via Method 3!');
                    return result;
                } catch (error3) {
                    console.error('❌ Semua method gagal');
                    console.error('Error 1:', error1.message);
                    console.error('Error 2:', error2.message);
                    console.error('Error 3:', error3.message);
                    
                    throw new Error(`Gagal mengirim pesan: ${error3.message}`);
                }
            }
        }

    } catch (error) {
        console.error('❌ Error mengirim pesan:', error.message);
        
        // Auto-reconnect jika ada koneksi issue
        if (error.message.includes('terhubung') || error.message.includes('disconnected')) {
            console.log('🔄 Mencoba reconnect...');
            try {
                await client.initialize();
                await sleep(3000);
            } catch (reconnectError) {
                console.error('Reconnect gagal:', reconnectError.message);
            }
        }
        
        throw error;
    }
}

// Ubah urutan inisialisasi
async function main() {
    await initializeWA();
    initializeHTTP();
}

// Jalankan fungsi utama
main().catch(error => {
    console.error('Main error:', error);
    fs.appendFileSync(path.join(logDirectory, 'access.log'),
        `[${moment().format('YYYY-MM-DD HH:mm:ss')}] MAIN ERROR: ${error.message}\n`);
});