const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const Notification = require('../models/Notification');
const { User } = require('../models/User');

// Get notifications for the authenticated user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, unread_only = false } = req.query;
    const userId = req.user.userId;
    const userType = req.user.role;

    console.log('🔍 Fetching notifications for user:', { userId, userType, page, limit, unread_only });

    let query = {
      recipient_id: userId,
      recipient_type: userType
    };

    if (unread_only === 'true') {
      query.read = false;
    }

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({
      recipient_id: userId,
      recipient_type: userType,
      read: false
    });

    console.log('📊 Notification query results:', { 
      total, 
      unreadCount, 
      found: notifications.length,
      query 
    });

    res.json({
      notifications: notifications.map(notif => ({
        id: notif._id,
        title: notif.title,
        message: notif.message,
        type: notif.type,
        priority: notif.priority,
        read: notif.read,
        read_at: notif.read_at,
        created_at: notif.createdAt,
        related_id: notif.related_id,
        related_type: notif.related_type,
        metadata: notif.metadata
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      unreadCount
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark notification as read
router.put('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.userId;

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient_id: userId
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    await notification.markAsRead();

    res.json({ 
      message: 'Notification marked as read',
      notification: {
        id: notification._id,
        read: notification.read,
        read_at: notification.read_at
      }
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userType = req.user.role;

    const result = await Notification.updateMany(
      {
        recipient_id: userId,
        recipient_type: userType,
        read: false
      },
      {
        read: true,
        read_at: new Date()
      }
    );

    res.json({ 
      message: `${result.modifiedCount} notifications marked as read`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get unread count
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userType = req.user.role;

    const unreadCount = await Notification.countDocuments({
      recipient_id: userId,
      recipient_type: userType,
      read: false
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete notification
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.userId;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipient_id: userId
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;