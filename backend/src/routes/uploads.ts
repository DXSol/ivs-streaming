import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// Ensure uploads directory exists
// Use environment variable or fallback to relative path
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o755 });
  }
  // Test write permissions
  const testFile = path.join(uploadsDir, '.write-test');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('Uploads directory ready:', uploadsDir);
} catch (err) {
  console.error('Uploads directory issue:', uploadsDir, err);
  // Directory may already exist or be created via Docker volume
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `poster-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});

// POST /uploads/poster - Upload a poster image (admin only)
router.post('/poster', requireAuth, requireAdmin, upload.single('poster'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Return the URL path to access the uploaded file
  const fileUrl = `/uploads/${req.file.filename}`;
  
  return res.status(201).json({
    url: fileUrl,
    filename: req.file.filename,
    size: req.file.size,
  });
});

export default router;
