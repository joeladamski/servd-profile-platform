const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  console.error("Missing DATABASE_URL or SESSION_SECRET environment variable.");
  process.exit(1);
}

const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new pgSession({ pool, tableName: "sessions", createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      secure: false,
      httpOnly: true,
      sameSite: "lax"
    }
  })
);
app.use("/uploads", express.static(uploadsDir));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT,
      bio TEXT,
      avatar_path TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS links (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title, content) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #0f0f12; color: #f5f5f5; }
    .wrap { max-width: 760px; margin: 2rem auto; padding: 1rem; }
    .card { background: #18181d; border: 1px solid #2a2a33; border-radius: 16px; padding: 1.2rem; }
    input, textarea { width: 100%; box-sizing: border-box; margin: .35rem 0 1rem; padding: .7rem; border-radius: 10px; border: 1px solid #30303a; background: #101014; color: #f5f5f5; }
    button, .btn { background: linear-gradient(135deg, #c49b33, #e9c56a); border: 0; padding: .7rem 1rem; border-radius: 999px; color: #1a1200; font-weight: 700; text-decoration: none; display: inline-block; cursor: pointer; }
    a { color: #e9c56a; }
    .small { color: #aaa; font-size: .92rem; }
    .danger { color: #ff8d8d; }
    .profile { text-align: center; padding-top: 3rem; }
    .avatar-lg { width: 220px; height: 220px; border-radius: 50%; object-fit: cover; border: 4px solid #c49b33; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
    .username { color: #b7b7c5; margin-top: .5rem; }
    .bio { max-width: 560px; margin: 1rem auto 1.2rem; color: #ddd; white-space: pre-wrap; }
    .links { display: grid; gap: .8rem; max-width: 500px; margin: 0 auto; }
    .link-item { background: #20202a; border: 1px solid #2f2f39; border-radius: 12px; padding: .9rem 1rem; text-decoration: none; color: #f5f5f5; }
    .split { display: grid; gap: 1rem; grid-template-columns: 1fr; }
    @media (min-width: 760px){ .split { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">${content}</div>
</body>
</html>`;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.send(
    page(
      "Servd.Pro",
      `<div class="card"><h1>Servd.Pro Profile Platform</h1>
      <p>Create your profile and share your links.</p>
      <p><a class="btn" href="/signup">Sign up</a> <a class="btn" href="/login">Login</a></p></div>`
    )
  );
});

app.get("/signup", (req, res) => {
  res.send(
    page(
      "Sign up",
      `<div class="card"><h2>Create account</h2>
      <form method="post" action="/signup">
        <label>Username</label><input name="username" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" />
        <label>Password</label><input name="password" type="password" required minlength="6" />
        <button type="submit">Create account</button>
      </form></div>`
    )
  );
});

app.post("/signup", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 6) {
      return res.status(400).send(page("Sign up", `<div class="card danger">Invalid username or password.</div>`));
    }
    const hash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
      [username, hash]
    );
    await pool.query("INSERT INTO profiles (user_id, display_name, bio) VALUES ($1, $2, $3)", [
      userResult.rows[0].id,
      username,
      ""
    ]);
    req.session.userId = userResult.rows[0].id;
    req.session.username = username;
    res.redirect("/dashboard");
  } catch (error) {
    console.error(error);
    res.status(400).send(page("Sign up", `<div class="card danger">Username already exists.</div>`));
  }
});

app.get("/login", (req, res) => {
  res.send(
    page(
      "Login",
      `<div class="card"><h2>Login</h2>
      <form method="post" action="/login">
        <label>Username</label><input name="username" required />
        <label>Password</label><input name="password" type="password" required />
        <button type="submit">Login</button>
      </form></div>`
    )
  );
});

app.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const userResult = await pool.query("SELECT id, username, password_hash FROM users WHERE username = $1", [username]);
  if (!userResult.rowCount) {
    return res.status(401).send(page("Login", `<div class="card danger">Invalid credentials.</div>`));
  }
  const user = userResult.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).send(page("Login", `<div class="card danger">Invalid credentials.</div>`));
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect("/dashboard");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/dashboard", requireAuth, async (req, res) => {
  const profileResult = await pool.query("SELECT * FROM profiles WHERE user_id = $1", [req.session.userId]);
  const linksResult = await pool.query("SELECT id, label, url, sort_order FROM links WHERE user_id = $1 ORDER BY sort_order, id", [
    req.session.userId
  ]);
  const profile = profileResult.rows[0] || {};

  const linkRows = linksResult.rows
    .map(
      (link) => `<div class="split"><input name="link_label_${link.id}" value="${esc(link.label)}" />
      <input name="link_url_${link.id}" value="${esc(link.url)}" /></div>`
    )
    .join("");

  res.send(
    page(
      "Dashboard",
      `<div class="card">
        <h2>Dashboard</h2>
        <p class="small">Public profile: <a href="/u/${esc(req.session.username)}">${baseUrl}/u/${esc(req.session.username)}</a></p>
        <form method="post" action="/dashboard" enctype="multipart/form-data">
          <label>Display name</label><input name="display_name" maxlength="80" value="${esc(profile.display_name || "")}" />
          <label>Bio</label><textarea name="bio" rows="4" maxlength="280">${esc(profile.bio || "")}</textarea>
          <label>Profile image (JPG/PNG/WEBP)</label><input type="file" name="avatar" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" />
          <h3>Links</h3>
          <p class="small">Use one link per line in format: Label | https://example.com</p>
          <textarea name="links_raw" rows="6">${esc(
            linksResult.rows.map((l) => `${l.label} | ${l.url}`).join("\n")
          )}</textarea>
          <button type="submit">Save profile</button>
        </form>
        <form method="post" action="/logout" style="margin-top:1rem;"><button type="submit">Logout</button></form>
      </div>`
    )
  );
});

app.post("/dashboard", requireAuth, upload.single("avatar"), async (req, res) => {
  const displayName = String(req.body.display_name || "").trim().slice(0, 80);
  const bio = String(req.body.bio || "").trim().slice(0, 280);

  let avatarPath;
  if (req.file) {
    const fileName = `avatar-${req.session.userId}.webp`;
    const fullPath = path.join(uploadsDir, fileName);
    await sharp(req.file.buffer).resize(512, 512, { fit: "cover" }).webp({ quality: 90 }).toFile(fullPath);
    avatarPath = `/uploads/${fileName}`;
  }

  await pool.query(
    `UPDATE profiles
     SET display_name = $1, bio = $2, updated_at = NOW(), avatar_path = COALESCE($3, avatar_path)
     WHERE user_id = $4`,
    [displayName, bio, avatarPath || null, req.session.userId]
  );

  const raw = String(req.body.links_raw || "");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);

  await pool.query("DELETE FROM links WHERE user_id = $1", [req.session.userId]);
  for (let i = 0; i < lines.length; i += 1) {
    const [labelPart, urlPart] = lines[i].split("|");
    const label = (labelPart || "").trim();
    const url = (urlPart || "").trim();
    if (!label || !/^https?:\/\//i.test(url)) continue;
    await pool.query("INSERT INTO links (user_id, label, url, sort_order) VALUES ($1, $2, $3, $4)", [
      req.session.userId,
      label.slice(0, 60),
      url.slice(0, 300),
      i
    ]);
  }

  res.redirect("/dashboard");
});

app.get("/u/:username", async (req, res) => {
  const username = String(req.params.username || "").toLowerCase();
  const result = await pool.query(
    `SELECT u.username, p.display_name, p.bio, p.avatar_path, u.id
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.username = $1`,
    [username]
  );

  if (!result.rowCount) {
    return res.status(404).send(page("Not found", `<div class="card">Profile not found.</div>`));
  }

  const user = result.rows[0];
  const links = await pool.query("SELECT label, url FROM links WHERE user_id = $1 ORDER BY sort_order, id", [user.id]);

  const avatar = user.avatar_path || "https://via.placeholder.com/512/1a1a20/e9c56a?text=Servd";

  res.send(
    page(
      `${user.display_name || user.username}`,
      `<div class="profile">
        <img class="avatar-lg" src="${esc(avatar)}" alt="${esc(user.username)} avatar" />
        <h1>${esc(user.display_name || user.username)}</h1>
        <div class="username">@${esc(user.username)}</div>
        <div class="bio">${esc(user.bio || "")}</div>
        <div class="links">
          ${links.rows
            .map((link) => `<a class="link-item" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}</a>`)
            .join("")}
        </div>
      </div>`
    )
  );
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Database init failed", error);
    process.exit(1);
  });
