const express = require('express');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { setTimeout } = require('timers/promises');
const { Client, LocalAuth, Buttons } = require('whatsapp-web.js');
const cors = require("cors");
const axios = require('axios');
const morgan = require('morgan');
const rfs = require('rotating-file-stream');
const moment = require('moment-timezone'); // Tambahkan ini
require('dotenv').config()
const app = express();

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
                    '--single-process',
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
                await new Promise(resolve => setTimeout(resolve, 5000));
                
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
        await new Promise(resolve => setTimeout(resolve, 30000));
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

    // Endpoint /sendmessage yang baru dengan timeout dan error handling yang lebih baik
    app.post('/sendmessage', async (req, res) => {
        const timeout = 30000; // 30 detik timeout
        let timeoutId;

        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error('Request timeout after 30 seconds'));
                }, timeout);
            });

            const { to, message } = req.body;

            // Validasi input
            if (!to || !message) {
                clearTimeout(timeoutId);
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

            // Race between timeout and message sending
            const result = await Promise.race([
                sendWhatsAppMessage(formattedNumber, message),
                timeoutPromise
            ]);

            clearTimeout(timeoutId);

            // Log sukses
            console.log('Message sent successfully to:', formattedNumber);
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] PESAN TERKIRIM KE: ${formattedNumber}\n`);

            return res.status(200).json({
                status: true,
                message: 'Pesan terkirim',
                data: result
            });

        } catch (error) {
            clearTimeout(timeoutId);
            console.error('Send message error:', error);
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] SEND ERROR: ${error.message}\n`);

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

// Modify the sendWhatsAppMessage function
async function sendWhatsAppMessage(to, message) {
    if (!client) {
        throw new Error('Client WhatsApp belum terinisialisasi');
    }

    try {
        // Get state and wait for connection
        let attempts = 0;
        const maxStateAttempts = 5;
        
        while (attempts < maxStateAttempts) {
            const state = await client.getState();
            console.log('Current WhatsApp state:', state);
            
            if (state === 'CONNECTED') {
                break;
            }
            
            attempts++;
            if (attempts === maxStateAttempts) {
                throw new Error('WhatsApp gagal terhubung setelah beberapa percobaan');
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Verifikasi nomor dengan retry
        console.log('Verifying number:', to);
        let isRegistered = false;
        attempts = 0;
        const maxVerifyAttempts = 3;

        while (attempts < maxVerifyAttempts) {
            try {
                isRegistered = await client.isRegisteredUser(to);
                if (isRegistered) break;
            } catch (error) {
                console.log(`Verify attempt ${attempts + 1} failed:`, error);
            }
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!isRegistered) {
            throw new Error('Nomor tidak terdaftar di WhatsApp');
        }

        // Kirim pesan dengan retry
        attempts = 0;
        const maxSendAttempts = 3;
        let lastError;

        while (attempts < maxSendAttempts) {
            try {
                console.log(`Percobaan ${attempts + 1} mengirim pesan`);
                
                // Tunggu sampai halaman siap dan Store tersedia
                await client.pupPage.waitForFunction(() => {
                    return window.Store && window.Store.Chat && typeof window.Store.Chat.find === 'function';
                }, { timeout: 5000 }).catch(() => {
                    console.log('Store tidak fully loaded, lanjutkan');
                });
                
                const result = await client.sendMessage(to, message);
                console.log('Pesan berhasil dikirim');
                return result;
            } catch (error) {
                console.error(`Percobaan ${attempts + 1} gagal:`, error.message);
                lastError = error;
                attempts++;
                
                if (attempts === maxSendAttempts) break;
                
                // Tunggu lebih lama antar percobaan dengan exponential backoff
                const delayMs = 3000 * (attempts);
                console.log(`Menunggu ${delayMs}ms sebelum percobaan berikutnya...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        
        throw lastError;
    } catch (error) {
        console.error('Kesalahan mengirim pesan:', error);
        
        // Jika error Store/getChat, coba reinisialisasi
        if (error.message.includes('getChat') || error.message.includes('Session')) {
            console.log('Error Store terdeteksi, menginisialisasi ulang...');
            await initializeWA();
            throw new Error('Sesi WhatsApp perlu diperbarui, silakan coba lagi');
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