const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envAtBackendRoot = path.resolve(__dirname, '../.env');
const envAtSrc = path.resolve(__dirname, '.env');

if (fs.existsSync(envAtBackendRoot)) {
  dotenv.config({ path: envAtBackendRoot });
} else if (fs.existsSync(envAtSrc)) {
  dotenv.config({ path: envAtSrc });
} else {
  dotenv.config();
}

const { authMiddleware } = require('./middleware/auth');
const streamsRouter = require('./routes/streams');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', authMiddleware);
app.use('/api/streams', streamsRouter);

const port = process.env.PORT || 5050;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});
