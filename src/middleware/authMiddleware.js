const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

dotenv.config();

// Utility function to extract token from Authorization header
const extractToken = (req) => {
  const authHeader = req.headers.authorization || req.header("Authorization");
  if (!authHeader) return null;

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return authHeader;
};

const authMiddleware = (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: "No token, authorization denied" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Token is not valid" });
  }
};

module.exports = { authMiddleware, extractToken };