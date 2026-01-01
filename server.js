// Disable SSL certificate validation for cloud database (development)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Discord Webhook URLs
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1456055962216431620/PuBDqeqwIBQOxF1EPz8XvhAdXU2JRSndw0Gbf-HJC6qQXaDetRaXCnRPLEcvPxchuzB6';
const VOUCH_WEBHOOK_URL = 'https://discord.com/api/webhooks/1417631212255838249/STxUKjhMPcLhPDIzZF6shrB8VcNeSdcR8TA9kCp-_OC8bNhqkGsK3RQXHfISAH7wWE24';

// Send message to Discord webhook (generic)
function sendToWebhook(webhookUrl, payload) {
    try {
        const data = JSON.stringify(payload);
        const url = new URL(webhookUrl);
        
        const options = {
            method: 'POST',
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        
        const req = https.request(options, (res) => {
            if (res.statusCode !== 204 && res.statusCode !== 200) {
                console.error(`Webhook response: ${res.statusCode}`);
            }
        });
        
        req.on('error', (err) => {
            console.error('Discord webhook error:', err.message);
        });
        
        req.write(data);
        req.end();
    } catch (err) {
        console.error('Failed to send webhook:', err.message);
    }
}

// Send message to Discord webhook
function sendDiscordWebhook(message, embeds = null) {
    try {
        const payload = { content: message };
        if (embeds) payload.embeds = embeds;
        sendToWebhook(DISCORD_WEBHOOK_URL, payload);
    } catch (err) {
        console.error('Failed to send webhook:', err.message);
    }
}

// Create invoice with NOWPayments (or other provider) - returns { invoice_id, payment_url }
async function createInvoiceNOWPayments({ order_id, amount, currency, callback_url, success_url, cancel_url, pay_currency }) {
    return new Promise((resolve, reject) => {
        try {
            const payload = JSON.stringify({
                price_amount: amount,
                price_currency: currency,
                order_id,
                order_description: `Order ${order_id}`,
                ipn_callback_url: callback_url,
                success_url: success_url,
                cancel_url: cancel_url,
                pay_currency: pay_currency || null
            });

            const options = {
                method: 'POST',
                hostname: 'api.nowpayments.io',
                path: '/v1/invoice',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'x-api-key': process.env.NOWPAYMENTS_API_KEY || ''
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json && (json.invoice_id || json.id || json.data && json.data.id)) {
                            // Normalize
                            const invoiceId = json.invoice_id || json.id || (json.data && json.data.id);
                            const paymentUrl = json.payment_url || json.invoice_url || (json.data && json.data.invoice_url) || json.data && json.data.url;
                            resolve({ invoice_id: invoiceId, payment_url: paymentUrl, raw: json });
                        } else {
                            reject(new Error('Invalid invoice response: ' + data));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.write(payload);
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

// Create invoice with MoneyMotion - returns { invoice_id, payment_url }
async function createInvoiceMoneyMotion({ order_id, amount, currency, callback_url, success_url, cancel_url }) {
    return new Promise((resolve, reject) => {
        try {
            const payload = JSON.stringify({
                order_id,
                amount: Math.round(amount * 100), // MoneyMotion expects cents
                currency: currency.toUpperCase(),
                description: `Order ${order_id}`,
                webhook_url: callback_url,
                success_url: success_url,
                cancel_url: cancel_url,
                metadata: { order_id }
            });

            const options = {
                method: 'POST',
                hostname: 'api.moneymotion.io',
                path: '/v1/invoices',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'Authorization': `Bearer ${process.env.MONEYMOTION_API_KEY || ''}`
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json && (json.id || json.invoice_id)) {
                            const invoiceId = json.id || json.invoice_id;
                            const paymentUrl = json.checkout_url || json.payment_url || json.hosted_url || `https://checkout.moneymotion.io/${invoiceId}`;
                            resolve({ invoice_id: invoiceId, payment_url: paymentUrl, raw: json });
                        } else {
                            reject(new Error('Invalid MoneyMotion response: ' + data));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.write(payload);
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

// Generic invoice creator - support both NOWPayments and MoneyMotion
async function createInvoice(params) {
    const provider = params.provider || process.env.DEFAULT_PAYMENT_PROVIDER || 'nowpayments';
    
    if (provider === 'moneymotion' && process.env.MONEYMOTION_API_KEY) {
        return createInvoiceMoneyMotion(params);
    }
    if (provider === 'nowpayments' && process.env.NOWPAYMENTS_API_KEY) {
        return createInvoiceNOWPayments(params);
    }
    
    // Fallback to first available provider
    if (process.env.NOWPAYMENTS_API_KEY) {
        return createInvoiceNOWPayments(params);
    }
    if (process.env.MONEYMOTION_API_KEY) {
        return createInvoiceMoneyMotion(params);
    }
    
    throw new Error('No payment provider configured. Set NOWPAYMENTS_API_KEY or MONEYMOTION_API_KEY.');
}

// PostgreSQL database connection
const pool = new Pool({
    host: 'j5da91anmp.qm2ovfd5ps.tsdb.cloud.timescale.com',
    port: 33040,
    database: 'tsdb',
    user: 'tsdbadmin',
    password: 'k98um5eml8twr66n',
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error connecting to database:', err.message);
        console.error('Full error:', err);
    } else {
        console.log('✅ Connected to PostgreSQL database');
        release();
        initializeDatabase().catch(err => {
            console.error('❌ Failed to initialize database:', err.message);
        });
    }
});

// Handle pool errors
pool.on('error', (err) => {
    console.error('❌ Unexpected database pool error:', err.message);
});

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Debug middleware: log incoming API requests and cookies to help session debugging
app.use((req, res, next) => {
    try {
        if (req.path && req.path.startsWith('/api/')) {
            console.log('➡️', req.method, req.path, 'Cookies:', req.headers && req.headers.cookie);
        }
    } catch (e) {
        // swallow logging errors
    }
    next();
});
app.use(session({
    secret: 'atlasmarket-secret-key-change-in-production',
    resave: true,
    saveUninitialized: false,
    name: 'atlasmarket.sid',
    cookie: { 
        secure: false, 
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax',
        path: '/'
    }
}));

async function initializeDatabase() {
    try {
        console.log('Initializing database tables...');
        
        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table ready');

        // Create vouches table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vouches (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                username VARCHAR(50) NOT NULL,
                product VARCHAR(100) NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                comment TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Vouches table ready');

        // Create products table (include delivery fields)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                price NUMERIC(10,2) NOT NULL DEFAULT 0,
                stock_status VARCHAR(50) DEFAULT 'in-stock',
                stock_quantity INTEGER DEFAULT 0,
                banner VARCHAR(500),
                description TEXT,
                delivery_type VARCHAR(50) DEFAULT 'file', -- 'file' or 'license'
                file_path VARCHAR(1000), -- server-side protected path for digital file
                license_pool TEXT, -- optional comma-separated license keys or JSON
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Products table ready');
        // Ensure column exists for existing installations
        try {
            await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0");
        } catch (e) {
            // ignore
        }

        // Orders table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                order_id VARCHAR(100) UNIQUE NOT NULL,
                product_id INTEGER,
                product_name VARCHAR(200),
                amount NUMERIC(12,6) NOT NULL,
                currency VARCHAR(10) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending', -- pending, paid, delivered, failed
                invoice_id VARCHAR(200),
                payment_url VARCHAR(1000),
                delivery_data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
            )
        `);
        console.log('✅ Orders table ready');

        // One-time download tokens
        await pool.query(`
            CREATE TABLE IF NOT EXISTS download_tokens (
                token VARCHAR(200) PRIMARY KEY,
                order_id VARCHAR(100) NOT NULL,
                product_id INTEGER,
                file_path VARCHAR(1000) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Download tokens table ready');

        // License keys assigned per order
        await pool.query(`
            CREATE TABLE IF NOT EXISTS license_keys (
                id SERIAL PRIMARY KEY,
                order_id VARCHAR(100) NOT NULL,
                license_key VARCHAR(500) NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ License keys table ready');

        // Order logs for auditing
        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_logs (
                id SERIAL PRIMARY KEY,
                order_id VARCHAR(100) NOT NULL,
                status VARCHAR(50) NOT NULL,
                detail TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Order logs table ready');

        // Create announcements table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS announcements (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200),
                message TEXT NOT NULL,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Announcements table ready');

        console.log('✅ Database tables initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database:', error.message);
        console.error('Full error:', error);
        throw error;
    }
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

// Admin middleware: allow if session username matches ADMIN_USER or if correct admin secret header provided
const ADMIN_USER = process.env.ADMIN_USER || 'Atlas';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'atlas-secret';
function requireAdmin(req, res, next) {
    try {
        if ((req.session && req.session.username && req.session.username === ADMIN_USER) || (req.headers && req.headers['x-admin-secret'] === ADMIN_SECRET)) {
            return next();
        }
    } catch (e) {}
    return res.status(403).json({ error: 'Admin privileges required' });
}

// API Routes

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
            [username, email, hashedPassword]
        );

        // Auto-login after registration
        req.session.userId = result.rows[0].id;
        req.session.username = username;
        
        // Send Discord webhook
        sendDiscordWebhook(`📝 **New Account Registration**\n**Username:** ${username}\n**Email:** ${email}`);
        
        res.json({ 
            success: true, 
            message: 'Account created successfully',
            userId: result.rows[0].id,
            username: username
        });
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === '23505') { // Unique constraint violation
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        if (error.code === '42P01') { // Table doesn't exist
            console.error('Table does not exist. Initializing database...');
            await initializeDatabase();
            return res.status(500).json({ error: 'Database not ready. Please try again in a moment.' });
        }
        res.status(500).json({ 
            error: 'Registration failed',
            details: error.message || 'Unknown error occurred'
        });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1 OR email = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Set session data
        req.session.userId = user.id;
        req.session.username = user.username;
        
        console.log('Session set - userId:', req.session.userId, 'username:', req.session.username);

        // Save session explicitly and then respond
        req.session.save((err) => {
            if (err) {
                console.error('❌ Session save error:', err);
                return res.status(500).json({ error: 'Failed to create session' });
            }
            
            console.log('✅ Session saved successfully');
            
            // Send Discord webhook
            sendDiscordWebhook(`🔓 **User Login**\n**Username:** ${user.username}`);
            
            res.json({ 
                success: true, 
                message: 'Login successful',
                userId: user.id,
                username: user.username
            });
        });
    } catch (error) {
        console.error('❌ Login error:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            error: 'Login failed',
            details: error.message
        });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// Check session
app.get('/api/session', (req, res) => {
    console.log('Session check - userId:', req.session?.userId, 'username:', req.session?.username);
    if (req.session && req.session.userId) {
        res.json({ 
            authenticated: true, 
            userId: req.session.userId,
            username: req.session.username
        });
    } else {
        res.json({ authenticated: false });
    }
});

// Get user info
app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, email, created_at FROM users WHERE id = $1',
            [req.session.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch user info' });
    }
});

// Create vouch
app.post('/api/vouches', requireAuth, async (req, res) => {
    const { product, rating, comment } = req.body;

    if (!product || !rating || !comment) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO vouches (user_id, username, product, rating, comment) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [req.session.userId, req.session.username, product, rating, comment]
        );

        res.json({ 
            success: true, 
            message: 'Vouch created successfully',
            vouchId: result.rows[0].id
        });
        
        // Send Discord embed webhook for public vouch display
        const vouchEmbed = {
            title: '⭐ New Vouch',
            description: comment,
            color: 3066993, // Green
            fields: [
                { name: 'User', value: req.session.username, inline: true },
                { name: 'Product', value: product, inline: true },
                { name: 'Rating', value: '⭐'.repeat(rating) + '☆'.repeat(5 - rating), inline: true }
            ],
            timestamp: new Date().toISOString(),
            footer: { text: 'AtlasMarket Vouches' }
        };
        sendToWebhook(VOUCH_WEBHOOK_URL, { embeds: [vouchEmbed] });
    } catch (error) {
        console.error('Create vouch error:', error);
        res.status(500).json({ error: 'Failed to create vouch' });
    }
});

// Get all vouches
app.get('/api/vouches', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT v.*, u.email FROM vouches v LEFT JOIN users u ON v.user_id = u.id ORDER BY v.created_at DESC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get vouches error:', error);
        res.status(500).json({ error: 'Failed to fetch vouches' });
    }
});

// Get user's vouches
app.get('/api/vouches/my', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM vouches WHERE user_id = $1 ORDER BY created_at DESC',
            [req.session.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get user vouches error:', error);
        res.status(500).json({ error: 'Failed to fetch vouches' });
    }
});

// Delete vouch (owner only)
app.delete('/api/vouches/:id', requireAuth, async (req, res) => {
    const vouchId = req.params.id;

    try {
        const result = await pool.query(
            'DELETE FROM vouches WHERE id = $1 AND user_id = $2',
            [vouchId, req.session.userId]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ error: 'Vouch not found or unauthorized' });
        }

        res.json({ success: true, message: 'Vouch deleted successfully' });
    } catch (error) {
        console.error('Delete vouch error:', error);
        res.status(500).json({ error: 'Failed to delete vouch' });
    }
});

// Admin: delete any vouch
app.delete('/api/admin/vouches/:id', requireAdmin, async (req, res) => {
    const vouchId = req.params.id;
    try {
        const result = await pool.query('DELETE FROM vouches WHERE id = $1', [vouchId]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Vouch not found' });
        res.json({ success: true, message: 'Vouch deleted by admin' });
        
        // Send Discord webhook
        sendDiscordWebhook(`🗑️ **Vouch Deleted by Admin**\n**Vouch ID:** ${vouchId}`);
    } catch (err) {
        console.error('Admin delete vouch error:', err);
        res.status(500).json({ error: 'Failed to delete vouch' });
    }
});

// Products API
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Get products error:', err);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.post('/api/products', requireAdmin, async (req, res) => {
    // Accept stock_quantity (integer) and/or stock_status; derive status from quantity when not provided
    const { name, price, stock_status, stock_quantity, banner, description, delivery_type, file_path, license_pool } = req.body;
    console.log('📦 /api/products POST body:', req.body);
    console.log('📦 /api/products x-admin-secret header:', req.headers['x-admin-secret']);
    if (!name || typeof price === 'undefined') return res.status(400).json({ error: 'Name and price required' });

    // determine quantity and status
    const qty = typeof stock_quantity !== 'undefined' ? parseInt(stock_quantity, 10) : 0;
    let status = stock_status;
    if (!status) {
        if (isNaN(qty) || qty <= 0) status = 'out-of-stock';
        else if (qty <= 5) status = 'low-stock';
        else status = 'in-stock';
    }

    try {
        const result = await pool.query(
            'INSERT INTO products (name, price, stock_status, stock_quantity, banner, description, delivery_type, file_path, license_pool) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
            [name, price, status, qty, banner || null, description || null, delivery_type || 'file', file_path || null, license_pool || null]
        );
        console.log('📦 Product inserted:', result.rows[0]);
        res.json({ success: true, product: result.rows[0] });

        // Send Discord webhook (don't block response on webhook)
        try {
            sendDiscordWebhook(`🛍️ **New Product Added**\n**Name:** ${name}\n**Price:** $${price}\n**Stock:** ${status}`);
        } catch (webErr) {
            console.error('Webhook error (non-fatal):', webErr);
        }
    } catch (err) {
        console.error('Create product error:', err);
        res.status(500).json({ error: 'Failed to create product' });
    }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query('DELETE FROM products WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
        res.json({ success: true, message: 'Product deleted' });
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Announcements API
app.get('/api/announcements', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM announcements WHERE active = TRUE ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Get announcements error:', err);
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// Create an order and invoice
app.post('/api/orders', async (req, res) => {
    const { product_id, currency, provider } = req.body;
    if (!product_id || !currency) return res.status(400).json({ error: 'product_id and currency are required' });
    try {
        const p = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
        if (p.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
        const product = p.rows[0];
        const orderId = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
        const amount = Number(product.price);

        // Determine webhook callback based on provider
        let callbackUrl;
        if (provider === 'moneymotion') {
            callbackUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/api/webhook/moneymotion';
        } else {
            callbackUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/api/webhook/nowpayments';
        }
        
        const successUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/download-success.html';
        const cancelUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/download-cancel.html';

        const invoice = await createInvoice({ order_id: orderId, amount, currency, callback_url: callbackUrl, success_url: successUrl, cancel_url: cancelUrl, provider });

        // Store order
        await pool.query(
            'INSERT INTO orders (order_id, product_id, product_name, amount, currency, status, invoice_id, payment_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [orderId, product.id, product.name, amount, currency, 'pending', invoice.invoice_id || null, invoice.payment_url || null]
        );

        // Log order creation
        await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [orderId, 'created', `Invoice created via ${provider || 'default'}: ${invoice.invoice_id}`]);

        res.json({ success: true, order_id: orderId, payment_url: invoice.payment_url });
    } catch (err) {
        console.error('Create order error:', err);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Webhook endpoint for MoneyMotion (raw body to verify signature)
app.post('/api/webhook/moneymotion', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const raw = req.body; // Buffer
        const payloadText = raw.toString();
        const signature = req.headers['x-signature'] || req.headers['x-moneymotion-signature'] || '';
        const secret = process.env.MONEYMOTION_WEBHOOK_SECRET || '';

        // Verify signature if secret configured
        if (secret && signature) {
            try {
                const hmac = crypto.createHmac('sha256', secret).update(raw).digest('hex');
                if (hmac !== signature) {
                    console.error('MoneyMotion webhook signature mismatch');
                    return res.status(403).send('Invalid signature');
                }
            } catch (e) {
                console.error('MoneyMotion signature verify error', e);
                return res.status(500).send('Signature verification error');
            }
        }

        const body = JSON.parse(payloadText);
        console.log('💳 MoneyMotion webhook received:', body.event || body.type);

        // MoneyMotion payload structure
        const orderId = body.order_id || body.metadata?.order_id || null;
        const invoiceId = body.id || body.invoice_id || null;
        const status = body.status || body.payment_status || null;
        const event = body.event || body.type || null;

        if (!orderId && !invoiceId) {
            console.error('MoneyMotion webhook missing order/invoice id', body);
            return res.status(400).send('Missing id');
        }

        // Find order
        let orderRes;
        if (orderId) {
            orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
        }
        if ((!orderRes || orderRes.rowCount === 0) && invoiceId) {
            orderRes = await pool.query('SELECT * FROM orders WHERE invoice_id = $1', [invoiceId]);
        }

        if (!orderRes || orderRes.rowCount === 0) {
            console.error('Order not found for MoneyMotion webhook', orderId, invoiceId);
            return res.status(404).send('Order not found');
        }

        const order = orderRes.rows[0];

        // Idempotency: if already paid/delivered ignore repeated webhooks
        if (order.status === 'paid' || order.status === 'delivered') {
            console.log('MoneyMotion webhook for already processed order', order.order_id);
            await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'webhook_ignored', JSON.stringify(body).substring(0, 2000)]);
            return res.status(200).send('Already processed');
        }

        // Accept finalized statuses
        const paidStatuses = ['completed', 'confirmed', 'paid', 'successful', 'approved'];
        const paidEvents = ['payment.completed', 'payment.confirmed', 'payment.succeeded', 'invoice.paid'];
        
        const isPaid = (status && paidStatuses.includes(status.toLowerCase())) || (event && paidEvents.includes(event.toLowerCase()));

        if (isPaid) {
            // Mark order as paid
            await pool.query('UPDATE orders SET status = $1 WHERE order_id = $2', ['paid', order.order_id]);
            await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'paid', JSON.stringify(body).substring(0, 2000)]);

            // Create delivery artifact
            const prod = await pool.query('SELECT * FROM products WHERE id = $1', [order.product_id]);
            if (prod.rowCount > 0) {
                const product = prod.rows[0];
                if (product.delivery_type === 'license' && product.license_pool) {
                    // Allocate license
                    const poolArr = JSON.parse(product.license_pool || '[]');
                    const key = poolArr.length ? poolArr.shift() : null;
                    if (key) {
                        await pool.query('INSERT INTO license_keys (order_id, license_key) VALUES ($1,$2)', [order.order_id, key]);
                        await pool.query('UPDATE products SET license_pool = $1 WHERE id = $2', [JSON.stringify(poolArr), product.id]);
                        await pool.query('UPDATE orders SET delivery_data = $1 WHERE order_id = $2', [JSON.stringify({ type: 'license', key }), order.order_id]);
                        await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'delivered-license', key]);
                    }
                } else {
                    // Create download token
                    const token = crypto.randomBytes(24).toString('hex');
                    const expiresAt = new Date(Date.now() + (parseInt(process.env.DOWNLOAD_TOKEN_TTL_SECONDS || '3600') * 1000));
                    const filePath = product.file_path || product.banner || '';
                    await pool.query('INSERT INTO download_tokens (token, order_id, product_id, file_path, expires_at) VALUES ($1,$2,$3,$4,$5)', [token, order.order_id, product.id, filePath, expiresAt]);
                    await pool.query('UPDATE orders SET delivery_data = $1 WHERE order_id = $2', [JSON.stringify({ type: 'download', token, expires_at: expiresAt }), order.order_id]);
                    await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'delivered-download', `token:${token}`]);
                }

                // Decrement stock_quantity
                if (product.stock_quantity && product.stock_quantity > 0) {
                    const newQty = product.stock_quantity - 1;
                    let newStatus = product.stock_status;
                    if (newQty <= 0) newStatus = 'out-of-stock';
                    else if (newQty <= 5) newStatus = 'low-stock';
                    else newStatus = 'in-stock';
                    await pool.query('UPDATE products SET stock_quantity = $1, stock_status = $2 WHERE id = $3', [newQty, newStatus, product.id]);
                }
            }

            return res.status(200).send('OK');
        }

        // Not a final status; log and return
        await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'webhook_update', JSON.stringify(body).substring(0, 2000)]);
        res.status(200).send('Received');
    } catch (err) {
        console.error('MoneyMotion webhook processing error:', err, err.stack);
        res.status(500).send('Server error');
    }
});

// Webhook endpoint for NOWPayments (raw body to verify signature)
app.post('/api/webhook/nowpayments', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const raw = req.body; // Buffer
        const payloadText = raw.toString();
        let signature = req.headers['x-nowpayments-signature'] || req.headers['x-signature'] || req.headers['signature'];
        const secret = process.env.NOWPAYMENTS_WEBHOOK_SECRET || '';

        // Verify signature if secret configured
        if (secret && signature) {
            try {
                const hmac = crypto.createHmac('sha512', secret).update(raw).digest('hex');
                if (hmac !== signature) {
                    console.error('Webhook signature mismatch');
                    return res.status(403).send('Invalid signature');
                }
            } catch (e) {
                console.error('Signature verify error', e);
                return res.status(500).send('Signature verification error');
            }
        }

        const body = JSON.parse(payloadText);

        // Example: NOWPayments sends status field and order_id or invoice id
        const invoiceId = body.invoice_id || body.id || (body.data && body.data.id) || null;
        const orderId = body.order_id || (body.data && body.data.order_id) || null;
        const status = body.status || (body.data && body.data.status) || null;

        if (!orderId && !invoiceId) {
            console.error('Webhook missing order/invoice id', body);
            return res.status(400).send('Missing id');
        }

        // Find order by order_id or invoice_id
        let orderRes;
        if (orderId) {
            orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
        }
        if ((!orderRes || orderRes.rowCount === 0) && invoiceId) {
            orderRes = await pool.query('SELECT * FROM orders WHERE invoice_id = $1', [invoiceId]);
        }

        if (!orderRes || orderRes.rowCount === 0) {
            console.error('Order not found for webhook', orderId, invoiceId);
            return res.status(404).send('Order not found');
        }

        const order = orderRes.rows[0];

        // Idempotency: if already paid/delivered ignore repeated webhooks
        if (order.status === 'paid' || order.status === 'delivered') {
            console.log('Webhook received for already processed order', order.order_id);
            await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'webhook_ignored', JSON.stringify(body).substring(0,2000)]);
            return res.status(200).send('Already processed');
        }

        // Accept finalized statuses
        const paidStatuses = ['confirmed', 'finished', 'paid', 'successful'];
        if (status && paidStatuses.includes(status.toLowerCase())) {
            // mark paid
            await pool.query('UPDATE orders SET status = $1 WHERE order_id = $2', ['paid', order.order_id]);
            await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'paid', JSON.stringify(body).substring(0,2000)]);

            // Create delivery artifact depending on product
            const prod = await pool.query('SELECT * FROM products WHERE id = $1', [order.product_id]);
            if (prod.rowCount > 0) {
                const product = prod.rows[0];
                if (product.delivery_type === 'license' && product.license_pool) {
                    // allocate one license from pool
                    const poolArr = JSON.parse(product.license_pool || '[]');
                    const key = poolArr.length ? poolArr.shift() : null;
                    if (key) {
                        await pool.query('INSERT INTO license_keys (order_id, license_key) VALUES ($1,$2)', [order.order_id, key]);
                        await pool.query('UPDATE products SET license_pool = $1 WHERE id = $2', [JSON.stringify(poolArr), product.id]);
                        await pool.query('UPDATE orders SET delivery_data = $1 WHERE order_id = $2', [JSON.stringify({ type: 'license', key }), order.order_id]);
                        await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'delivered-license', key]);
                    } else {
                        await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'delivery_failed', 'No license available']);
                    }
                } else {
                    // create one-time download token
                    const token = crypto.randomBytes(24).toString('hex');
                    const expiresAt = new Date(Date.now() + (parseInt(process.env.DOWNLOAD_TOKEN_TTL_SECONDS || '3600') * 1000));
                    const filePath = product.file_path || product.banner || '';
                    await pool.query('INSERT INTO download_tokens (token, order_id, product_id, file_path, expires_at) VALUES ($1,$2,$3,$4,$5)', [token, order.order_id, product.id, filePath, expiresAt]);
                    await pool.query('UPDATE orders SET delivery_data = $1 WHERE order_id = $2', [JSON.stringify({ type: 'download', token, expires_at: expiresAt }), order.order_id]);
                    await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'delivered-download', `token:${token}`]);
                }

                // Decrement stock_quantity
                if (product.stock_quantity && product.stock_quantity > 0) {
                    const newQty = product.stock_quantity - 1;
                    let newStatus = product.stock_status;
                    if (newQty <= 0) newStatus = 'out-of-stock';
                    else if (newQty <= 5) newStatus = 'low-stock';
                    else newStatus = 'in-stock';
                    await pool.query('UPDATE products SET stock_quantity = $1, stock_status = $2 WHERE id = $3', [newQty, newStatus, product.id]);
                }
            }

            return res.status(200).send('OK');
        }

        // Not a final status; log and return
        await pool.query('INSERT INTO order_logs (order_id, status, detail) VALUES ($1,$2,$3)', [order.order_id, 'webhook_update', JSON.stringify(body).substring(0,2000)]);
        res.status(200).send('Received');
    } catch (err) {
        console.error('Webhook processing error:', err, err.stack);
        res.status(500).send('Server error');
    }
});

// Download endpoint - serves protected files using token
app.get('/download/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const dt = await pool.query('SELECT * FROM download_tokens WHERE token = $1', [token]);
        if (dt.rowCount === 0) return res.status(404).send('Invalid token');
        const row = dt.rows[0];
        if (row.used) return res.status(410).send('Token already used');
        if (new Date(row.expires_at) < new Date()) return res.status(410).send('Token expired');
        if (!row.file_path) return res.status(404).send('File not available');

        // Serve file securely; ensure path is under a configured folder
        const safeBase = path.join(__dirname, 'digital_files');
        const requested = path.resolve(row.file_path);
        if (!requested.startsWith(safeBase) && !requested.startsWith(path.resolve(__dirname))) {
            // don't allow arbitrary paths; but allow absolute paths within project
            console.error('Download path not allowed:', requested);
            return res.status(403).send('Access denied');
        }

        // Mark token used before sending to avoid replay (best-effort)
        await pool.query('UPDATE download_tokens SET used = TRUE WHERE token = $1', [token]);

        res.download(requested, err => {
            if (err) {
                console.error('Download error:', err);
            }
        });
    } catch (err) {
        console.error('Download endpoint error:', err);
        res.status(500).send('Server error');
    }
});

// Admin: list orders
app.get('/api/orders', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Get orders error:', err);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Public: get order status by order id
app.get('/api/orders/:order_id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE order_id = $1', [req.params.order_id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get order error:', err);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

app.post('/api/announcements', requireAdmin, async (req, res) => {
    const { title, message, active } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    try {
        const result = await pool.query('INSERT INTO announcements (title, message, active) VALUES ($1, $2, $3) RETURNING *', [title || null, message, active === false ? false : true]);
        res.json({ success: true, announcement: result.rows[0] });
        
        // Send Discord webhook
        sendDiscordWebhook(`📢 **Announcement Created**\n**Title:** ${title || 'No title'}\n**Message:** ${message}`);
    } catch (err) {
        console.error('Create announcement error:', err);
        res.status(500).json({ error: 'Failed to create announcement' });
    }
});

app.delete('/api/announcements/:id', requireAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Announcement not found' });
        res.json({ success: true, message: 'Announcement deleted' });
    } catch (err) {
        console.error('Delete announcement error:', err);
        res.status(500).json({ error: 'Failed to delete announcement' });
    }
});

app.listen(PORT, () => {
    console.log(`\n╔═══════════════════════════════════════╗`);
    console.log(`║   AtlasMarket Server Started!        ║`);
    console.log(`║   Server: http://localhost:${PORT}      ║`);
    console.log(`║   Keep this terminal open!           ║`);
    console.log(`╚═══════════════════════════════════════╝\n`);
});
