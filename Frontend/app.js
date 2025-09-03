const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const Authen = require("./control/authen");
const MySQLStore = require("express-mysql-session")(session);
const { db } = require("./utils/database");
const { dbConfig } = require("./utils/database");
const mysql = require('mysql2/promise');


const app = express();
const PORT = process.env.PORT || 3001;

function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Enhanced CORS configuration
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
  exposedHeaders: ['set-cookie']
}));

// Session store with enhanced configuration
const sessionStore = new MySQLStore({
  ...dbConfig,
  clearExpired: true,
  checkExpirationInterval: 900000,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
});

// Session error handling
sessionStore.on('error', (error) => {
  console.error('SESSION STORE ERROR:', error);
});

// Enhanced session middleware
app.use(session({
  name: 'transaction.sid',
  secret: "jklfsodifjsktnwjasdp465dd",
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 3600000,
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/'
  }
}));

// Session debugging middleware
app.use((req, res, next) => {
  console.log('Session ID:', req.sessionID);
  console.log('Session:', JSON.stringify(req.session, null, 2));
  next();
});

app.use((req, res, next) => {
  res.locals.message = req.session.message || null;
  delete req.session.message;
  next();
});

// Body parsers
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '30d' 
}));
// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (!req.session.authenticated) {
    console.log('Auth failed - session:', req.session);
    return res.redirect('/');
  }
  next();
};

// Routes
app.get("/", (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/dashboard');
  }
  res.render("login", { error: null });
});

// Fix: Change password to password_hash
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    // Check if username and password match a user in the database using password_hash
    const [rows] = await db.execute(
      'SELECT id, username FROM signUp WHERE username = ? AND password_hash = ?',
      [username, password]
    );

    if (rows.length > 0) {
      // User authenticated
      const user = rows[0];
      req.session.authenticated = true;
      req.session.userId = user.id;
      req.session.username = user.username;
      res.redirect("/dashboard");
    } else {
      // Authentication failed
      res.render('login', { title: 'Login', errorMessage: 'Invalid username or password' });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).render('login', { title: 'Login', errorMessage: 'An error occurred during login.' });
  }
});


global.liveMarkets = [
  { symbol: 'BTC/USDT', price: 115549.80, open: 115549.80, icon: '/source/bitcoin.png' },
  { symbol: 'ETH/USDT', price: 4342.18, open: 4342.18, icon: '/source/bitcoin.png' },
  { symbol: 'DOGE/USDT', price: 0.226099, open: 0.226099, icon: '/source/bitcoin.png' },
  { symbol: 'BCH/USDT', price: 571.02, open: 571.02, icon: '/source/bitcoin.png' },
  { symbol: 'LTC/USDT', price: 117.15, open: 117.15, icon: '/source/bitcoin.png' },
];

app.get("/dashboard", requireAuth, async (req, res) => {
  try {
    console.log('Accessing dashboard with session:', req.session);

    const [userResult] = await db.execute(
      'SELECT balance FROM signUp WHERE id = ?',
      [req.session.userId]
    );

    if (userResult.length === 0) {
      console.log(`User with ID ${req.session.userId} not found.`);
      return res.status(404).send('User not found');
    }

    const [depositResult] = await db.execute(`
      SELECT IFNULL(SUM(amount), 0) AS monthlyCashIn
      FROM deposit
      WHERE id = ?
      AND MONTH(created_at) = MONTH(CURRENT_DATE())
      AND YEAR(created_at) = YEAR(CURRENT_DATE())
    `, [req.session.userId]);

    const [withdrawResult] = await db.execute(`
      SELECT IFNULL(SUM(amount), 0) AS monthlyCashOut
      FROM withdrawals
      WHERE id = ?
      AND MONTH(created_at) = MONTH(CURRENT_DATE())
      AND YEAR(created_at) = YEAR(CURRENT_DATE())
    `, [req.session.userId]);

    const markets = Array.isArray(global.liveMarkets) ? global.liveMarkets : [];

    res.render("dashboard", {
      user: req.session.username,
      balance: userResult[0].balance,
      monthlyCashIn: depositResult[0].monthlyCashIn,
      monthlyCashOut: withdrawResult[0].monthlyCashOut,
      markets,
      active: 'dashboard'
    });

  } catch (err) {
    console.error('Error fetching dashboard data:', err);
    return res.status(500).send('Database error fetching dashboard data');
  }
});

app.get('/signup', (req, res) => {
  res.render('register');
});

// Fix: Change password to password_hash
app.post('/signup', async (req, res) => {
  const { username, phone_number, email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.send('Passwords do not match.');
  }

  try {
    // Insert user into DB with plain text password using password_hash column
    await db.execute(
      'INSERT INTO signUp (username, phone_number, email, password_hash) VALUES (?, ?, ?, ?)',
      [username, phone_number, email, password]
    );

    res.redirect('/');
  } catch (error) {
    console.error('Error inserting user:', error);
    res.status(500).send('An error occurred while creating the account.');
  }
});


app.get("/deposit", requireAuth, async (req, res) => {
  try {
    console.log('Accessing deposit with session:', req.session);

    const [results] = await db.execute('SELECT balance FROM signUp WHERE id = ?', [req.session.userId]);

    if (results.length === 0) {
      console.log(`User with ID ${req.session.userId} not found.`);
      return res.status(404).send('User not found');
    }

    res.render('deposit', {
      balance: results[0].balance,
      user: req.session.username
    });

  } catch (err) {
    console.error('Error fetching balance for deposit:', err);
    return res.status(500).send('Database error fetching balance');
  }
});

app.post("/deposit", requireAuth, async (req, res) => {
  const { amount, method, account } = req.body;

  try {
    await db.execute(
      'INSERT INTO deposit (id, amount, method, account) VALUES (?, ?, ?, ?)',
      [req.session.userId, amount, method, account]
    );

    const [updateResult] = await db.execute(
      'UPDATE signUp SET balance = balance + ? WHERE id = ?',
      [amount, req.session.userId]
    );

    if (updateResult.affectedRows === 0) {
      console.warn(`Balance not updated for user ID ${req.session.userId}`);
      return res.status(400).send('Balance update failed');
    }

    res.redirect("/dashboard");

  } catch (err) {
    console.error('Error processing deposit:', err);
    return res.status(500).send('Deposit failed');
  }
});


app.get("/withdraw", requireAuth, async (req, res) => {
  try {
    console.log('Accessing withdraw with session:', req.session);

    const [results] = await db.execute('SELECT balance FROM signUp WHERE id = ?', [req.session.userId]);

    if (results.length === 0) {
      console.log(`User with ID ${req.session.userId} not found.`);
      return res.status(404).send('User not found');
    }

    res.render('withdraw', {
      balance: results[0].balance,
      user: req.session.username
    });

  } catch (err) {
    console.error('Error fetching balance for withdraw:', err);
    return res.status(500).send('Database error fetching balance');
  }
});

app.post("/withdraw", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { amount, method, holderName, phoneNumber, cryptoId } = req.body;
    const amt = Number(amount);

    // Validation (optional)
    if (!amt || !method || !holderName || !phoneNumber || !cryptoId) {
      req.session.message = { type: "error", text: "All fields are required." };
      return req.session.save(() => res.redirect("/withdraw"));
    }

    // Optional: Check balance for user feedback
    const [rows] = await db.execute('SELECT balance FROM signUp WHERE id = ?', [userId]);
    if (!rows.length) {
      req.session.message = { type: "error", text: "User not found." };
      return req.session.save(() => res.redirect("/withdraw"));
    }
    if (parseFloat(rows[0].balance) < amt) {
      req.session.message = { type: "error", text: "Insufficient balance." };
      return req.session.save(() => res.redirect("/withdraw"));
    }

    // Insert withdrawal as pending (do NOT update balance here)
    await db.execute(
      "INSERT INTO withdrawals (id, amount, method, account, status) VALUES (?, ?, ?, ?, ?)",
      [userId, amt, method, account, "pending"]
    );

    req.session.message = { type: "success", text: "Withdrawal request submitted and is pending approval." };
    return req.session.save(() => res.redirect("/dashboard"));
  } catch (err) {
    console.error(err);
    req.session.message = { type: "error", text: "Error processing withdrawal." };
    return req.session.save(() => res.redirect("/withdraw"));
  }
});

app.get("/checkin", (req, res) => {
  res.render("checkin", { title: "Check In", errorMessage: "" });
});

app.get("/event", (req, res) => {
  res.render("event", {
    title: "Event",
    errorMessage: "",
    dashboardUrl: "/dashboard"
  });
});

app.get('/transactions', async (req, res, next) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const { search = '', type = '' } = req.query;
    const like = `%${search}%`;

    let withdraws = [];
    if (type === '' || type === 'Withdraw') {
      const wQuery = `
        SELECT withdraw_id AS id, created_at AS date, amount
        FROM withdrawals
        WHERE (? = '' OR withdraw_id LIKE ? OR created_at LIKE ?)
        ORDER BY created_at DESC
        LIMIT 10
      `;
      const [wRows] = await conn.execute(wQuery, [search, like, like]);
      withdraws = wRows.map(txn => ({
        ...txn,
        amount: Number(txn.amount),
        date: new Date(txn.date)
      }));
    }

    let deposits = [];
    if (type === '' || type === 'Deposit') {
      const dQuery = `
        SELECT deposit_id AS id, created_at AS date, amount
        FROM deposit
        WHERE (? = '' OR deposit_id LIKE ? OR created_at LIKE ?)
        ORDER BY created_at DESC
        LIMIT 10
      `;
      const [dRows] = await conn.execute(dQuery, [search, like, like]);
      deposits = dRows.map(txn => ({
        ...txn,
        amount: Number(txn.amount),
        date: new Date(txn.date)
      }));
    }

    await conn.end();

    res.render('transaction', {
      withdraws,
      deposits,
      search,
      type,
      dashboardUrl: '/dashboard'
    });
  } catch (err) {
    next(err);
  }
});

app.get("/order", requireAuth, async (req, res) => {
  try {
    console.log('Accessing order with session:', req.session);

    const [results] = await db.execute('SELECT username,balance,vip_status,credit_score FROM signUp WHERE id = ?', [req.session.userId]);

    if (results.length === 0) {
      console.log(`User with ID ${req.session.userId} not found.`);
      return res.status(404).send('User not found');
    }

    res.render('order', {
      username: results[0].username,
      balance: results[0].balance,
      user: req.session.username,
      vip_status: results[0].vip_status,
      credit_score: results[0].credit_score,
    });

  } catch (err) {
    console.error('Error fetching balance for order:', err);
    return res.status(500).send('Database error fetching balance');
  }
});

app.post('/order', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: 'Not logged in' });

    console.log('🟡 Incoming order from user ID:', userId);

    const [[{ balance: balStr }]] = await db.query(
      'SELECT balance FROM signUp WHERE id = ?',
      [userId]
    );
    const currentBalance = parseFloat(balStr);

    if (!Number.isFinite(currentBalance) || currentBalance < 50) {
      return res.status(403).json({
        message: '❌ Your balance must be at least $50 to start an order.'
      });
    }

    const [[{ count: countToday }]] = await db.query(
      `SELECT COUNT(*) AS count
      FROM start_actions
      WHERE id = ? AND DATE(action_time) = CURDATE()`,
      [userId]
    );
    console.log('🔢 Orders today:', countToday);

    if (countToday >= 50) {
      return res.status(403).json({ message: 'Daily limit reached (50/50)' });
    }

    const [settingsRows] = await db.query(
      `SELECT lucky_frequency, lucky_daily_limit
      FROM user_settings
      WHERE user_id = ?`,
      [userId]
    );
    const settingsMap = Object.fromEntries(settingsRows.map(r => [r.key_name, r.val]));
    const luckyFrequency = settingsMap.lucky_frequency ?? 5;
    const luckyDailyLimit = settingsMap.lucky_daily_limit ?? 10;

    const [[{ todayLuckyCount }]] = await db.query(
      `SELECT COUNT(*) AS todayLuckyCount
      FROM start_actions
      WHERE id = ? AND isLucky = 1 AND DATE(action_time) = CURDATE()`,
      [userId]
    );

    let isLuckyPlanned =
      (countToday + 1) % luckyFrequency === 0 &&
      todayLuckyCount < luckyDailyLimit;

    const hold = req.session.luckyHold;
    if (hold?.active) {
      const required = Number(hold.required ?? 50);
      const baseline = Number(hold.baseline ?? 0);

      if (currentBalance < baseline + required) {
        return res.status(403).json({
          message: '🎁 Lucky bonus available! Please make a deposit of $50 first to claim this bonus lucky order.',
          code: 'LUCKY_HOLD',
          remaining: 50 - countToday
        });
      } else {
        console.log('✅ Lucky hold satisfied. Granting lucky bonus now.');
        req.session.luckyHold = null;
        isLuckyPlanned = true;
      }
    }

    if (isLuckyPlanned && !hold?.active) {
      req.session.luckyHold = {
        active: true,
        baseline: currentBalance,
        required: 50,
        setAt: new Date().toISOString()
      };
      console.log('⛔ Lucky hit blocked. Hold set. Ask user to deposit +$50 to claim.');
      return res.status(403).json({
        message: '🎁 Lucky order hit! Please make a deposit of $50 first to claim this bonus lucky order.',
        code: 'LUCKY_SETUP',
        remaining: 50 - countToday
      });
    }

    const baseProfit = 0.5 * (countToday + 1);
    let profit = isLuckyPlanned ? 200 : baseProfit;
    profit = Number(profit.toFixed(2));

    const updatedBalance = Number((currentBalance + profit).toFixed(2));

    console.log(`💰 Current Balance: ${currentBalance}`);
    console.log(`💸 Profit Earned: ${profit}`);
    console.log(`🧾 New Balance: ${updatedBalance} (isLucky=${!!isLuckyPlanned})`);

    await db.query('UPDATE signUp SET balance = ? WHERE id = ?', [updatedBalance, userId]);
    await db.query('INSERT INTO start_actions (id, isLucky) VALUES (?, ?)', [userId, isLuckyPlanned ? 1 : 0]);

    res.json({
      message: isLuckyPlanned
        ? `🎉 Lucky Order! You earned $${profit}!`
        : `Order successful. You earned $${profit}.`,
      profit: profit.toFixed(2),
      updatedBalance: updatedBalance.toFixed(2),
      isLucky: !!isLuckyPlanned,
      remaining: 50 - (countToday + 1)
    });

  } catch (err) {
    console.error('❌ Error in /order:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get("/order-description", (req, res) => {
  res.render("orderdescription", { title: "Order description", errorMessage: "" });
});

app.get("/service", (req, res) => {
  res.render("service", { title: "Service", errorMessage: "" });
});

app.get("/faq", (req, res) => {
  res.render("faq", { title: "FAQs", errorMessage: "" });
});

app.get("/aboutus", (req, res) => {
  res.render("aboutus", { title: "About as", errorMessage: "" });
});

app.get("/service", (req, res) => {
  res.render("service", { title: "Service", errorMessage: "" });
});

app.get("/profile", requireAuth, async (req, res) => {
  try {
    const [results] = await db.execute(
      'SELECT username, balance, email, phone_number, vip_status, credit_score FROM signUp WHERE id = ?',
      [req.session.userId]
    );
    if (results.length === 0) return res.status(404).send('User not found');
    const userData = results[0];
    const inviteCode = generateInviteCode();
    res.render('profile', {
      username: userData.username,
      balance: userData.balance,
      email: userData.email,
      phone_number: userData.phone_number,
      inviteCode,
      vip_status: userData.vip_status,
      credit_score: userData.credit_score,
      dashboardUrl: '/dashboard',
      user: req.session.username
    });
  } catch (err) {
    res.status(500).send('Database error fetching profile');
  }
});

const DRIFT_PCT_MAX = 0.08;
setInterval(() => {
  global.liveMarkets = global.liveMarkets.map(m => {
    const sign = Math.random() < 0.5 ? -1 : 1;
    const mag = Math.random() * DRIFT_PCT_MAX;
    const next = +(m.price * (1 + sign * mag / 100)).toFixed(8);
    return { ...m, price: Math.max(0, next) };
  });
}, 3 * 60 * 1000);

app.get('/api/markets', (req, res) => {
  const data = global.liveMarkets.map(m => {
    const change = m.open > 0 ? ((m.price - m.open) / m.open) * 100 : 0;
    return { ...m, change };
  });
  res.json(data);
});

app.get('/market', requireAuth, (req, res) => {
  res.render('market', { markets: global.liveMarkets, active: 'market' });
});

app.post('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout session destroy error:', err);
      return next(err);
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

app.use((err, req, res, next) => {
  console.error('Application error:', err.stack);
  res.status(500).send('Internal server error');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('MySQL session store configured');
  console.log('Connected to MySQL database');
});
