const express = require('express');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { setTimeout } = require('timers/promises');
const { Client, LocalAuth, ClientInfo, Buttons } = require('whatsapp-web.js');
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
        localauth = new LocalAuth();
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
                // Tambahkan timeout
                timeout: 60000
            }
        });

        // Tunggu client siap sebelum melanjutkan
        await client.initialize();
        
        // Log inisialisasi berhasil
        fs.appendFileSync(path.join(logDirectory, 'access.log'), 
            `[${moment().format('YYYY-MM-DD HH:mm:ss')}] CLIENT INITIALIZED\n`);

    } catch (error) {
        fs.appendFileSync(path.join(logDirectory, 'access.log'),
            `[${moment().format('YYYY-MM-DD HH:mm:ss')}] INIT ERROR: ${error.message}\n`);
        
        // Coba inisialisasi ulang setelah 30 detik
        setTimeout(() => initializeWA(), 30000);
    }
}

function initializeHTTP(c) {
    app.get('/', (req, res, next) => {
        res.send('Welcome Whatsapp services');
    });

    app.post('/sendmessage', async (req, res, next) => {
        let to = req.body.to;
        let message = req.body.message;

        // Validasi client
        if (!client) {
            return res.status(503).send({
                status: false,
                message: 'Client WhatsApp belum terinisialisasi'
            });
        }

        try {
            // Tunggu client siap
            let attempts = 0;
            const maxAttempts = 3;
            
            while (attempts < maxAttempts) {
                const state = await client.getState();
                
                if (state === 'CONNECTED') {
                    break;
                }
                
                attempts++;
                if (attempts === maxAttempts) {
                    return res.status(503).send({
                        status: false,
                        message: 'WhatsApp tidak terhubung setelah beberapa percobaan'
                    });
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Format nomor
            if (!to) {
                return res.status(400).send({
                    status: false,
                    message: 'Nomor tujuan harus diisi'
                });
            }

            to = to.replace(/[^0-9]/g, '');
            if (to.startsWith('0')) {
                to = '62' + to.slice(1);
            } else if (!to.startsWith('62')) {
                to = '62' + to;
            }
            to = to + '@c.us';

            // Kirim pesan
            const result = await client.sendMessage(to, message);
            
            return res.send({
                status: true,
                message: 'Pesan terkirim',
                data: result
            });

        } catch (error) {
            console.error('Error:', error);
            fs.appendFileSync(path.join(logDirectory, 'access.log'),
                `[${moment().format('YYYY-MM-DD HH:mm:ss')}] SEND ERROR: ${error.message}\n`);
                
            return res.status(500).send({
                status: false,
                message: `Gagal mengirim pesan: ${error.message}`
            });
        }
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

    app.listen(port, () => {
        fs.appendFileSync(path.join(logDirectory, 'access.log'), `[${moment().format('YYYY-MM-DD HH:mm:ss')}] [INFO] listening to port ${port}\n`);
        console.log('listening to port', port);
    });
}

client.on("disconnected", async (reason) => {
    console.log('Client disconnected:', reason);
    fs.appendFileSync(path.join(logDirectory, 'access.log'),
        `[${moment().format('YYYY-MM-DD HH:mm:ss')}] DISCONNECTED: ${reason}\n`);
    
    // Destroy client
    if (client) {
        await client.destroy();
        client = null;
    }
    
    // Reinisialisasi setelah delay
    setTimeout(() => {
        console.log('Mencoba menghubungkan kembali...');
        initializeWA();
    }, 5000);
});

initializeWA();
initializeHTTP(client);