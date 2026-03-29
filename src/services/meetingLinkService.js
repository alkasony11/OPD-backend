const crypto = require('crypto');

class MeetingLinkService {
  constructor() {
    this.meetingProviders = {
      'jitsi': this.generateJitsiLink,
      'zoom': this.generateZoomLink,
      'google-meet': this.generateGoogleMeetLink,
      'webrtc': this.generateWebRTCLink
    };
  }

  /**
   * Generate a secure meeting link for video consultation
   * @param {string} appointmentId - Unique appointment identifier
   * @param {string} doctorId - Doctor's ID
   * @param {string} patientId - Patient's ID
   * @param {string} appointmentDate - Appointment date
   * @param {string} appointmentTime - Appointment time
   * @param {string} provider - Meeting provider (jitsi, zoom, google-meet, webrtc)
   * @returns {Object} Meeting link details
   */
  generateMeetingLink(appointmentId, doctorId, patientId, appointmentDate, appointmentTime, provider = 'jitsi') {
    try {
      const meetingId = this.generateMeetingId(appointmentId, doctorId, patientId);
      const meetingPassword = this.generateMeetingPassword();
      const meetingUrl = this.meetingProviders[provider](
        meetingId, 
        appointmentDate, 
        appointmentTime, 
        meetingPassword
      );

      return {
        meetingId,
        meetingUrl,
        meetingPassword,
        provider,
        expiresAt: this.calculateExpirationTime(appointmentDate, appointmentTime),
        createdAt: new Date(),
        isActive: true
      };
    } catch (error) {
      console.error('Error generating meeting link:', error);
      throw new Error('Failed to generate meeting link');
    }
  }

  /**
   * Generate a unique meeting ID
   */
  generateMeetingId(appointmentId, doctorId, patientId) {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    return `meet_${appointmentId}_${timestamp}_${randomString}`;
  }

  /**
   * Generate a secure meeting password
   */
  generateMeetingPassword() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  /**
   * Calculate when the meeting link should expire (24 hours after appointment time)
   */
  calculateExpirationTime(appointmentDate, appointmentTime) {
    const appointmentDateTime = new Date(`${appointmentDate}T${appointmentTime}`);
    const expirationTime = new Date(appointmentDateTime.getTime() + (24 * 60 * 60 * 1000)); // 24 hours later
    return expirationTime;
  }

  /**
   * Generate Jitsi Meet link
   */
  generateJitsiLink(meetingId, appointmentDate, appointmentTime, password) {
    const baseUrl = process.env.JITSI_BASE_URL || 'https://meet.jit.si';
    const roomName = `MediQ-${meetingId}`;
    const params = new URLSearchParams({
      jitsi_meet_external_api: '1',
      config: JSON.stringify({
        startWithAudioMuted: true,
        startWithVideoMuted: false,
        enableWelcomePage: false,
        prejoinPageEnabled: true,
        disableModeratorIndicator: false,
        startScreenSharing: false,
        enableEmailInStats: false
      })
    });

    return `${baseUrl}/${roomName}?${params.toString()}`;
  }

  /**
   * Generate Zoom link (requires Zoom API integration)
   */
  generateZoomLink(meetingId, appointmentDate, appointmentTime, password) {
    // This would require Zoom API integration
    // For now, return a placeholder that would be replaced with actual Zoom integration
    return `https://zoom.us/j/${meetingId}?pwd=${password}`;
  }

  /**
   * Generate Google Meet link
   */
  generateGoogleMeetLink(meetingId, appointmentDate, appointmentTime, password) {
    // Google Meet links are typically generated through Google Calendar API
    // For now, return a placeholder
    return `https://meet.google.com/${meetingId}`;
  }

  /**
   * Generate WebRTC link (custom implementation)
   */
  generateWebRTCLink(meetingId, appointmentDate, appointmentTime, password) {
    const baseUrl = process.env.WEBRTC_BASE_URL || 'https://meet.mediq.com';
    return `${baseUrl}/room/${meetingId}?password=${password}`;
  }

  /**
   * Validate meeting link
   */
  validateMeetingLink(meetingData) {
    if (!meetingData || !meetingData.meetingUrl || !meetingData.meetingId) {
      return false;
    }

    // Check if meeting has expired
    if (new Date() > new Date(meetingData.expiresAt)) {
      return false;
    }

    return true;
  }

  /**
   * Get meeting link status
   */
  getMeetingStatus(meetingData) {
    if (!this.validateMeetingLink(meetingData)) {
      return 'expired';
    }

    const now = new Date();
    const appointmentTime = new Date(`${meetingData.appointmentDate}T${meetingData.appointmentTime}`);
    const timeDiff = appointmentTime.getTime() - now.getTime();
    const hoursUntilAppointment = timeDiff / (1000 * 60 * 60);

    if (hoursUntilAppointment > 24) {
      return 'scheduled';
    } else if (hoursUntilAppointment > 0) {
      return 'ready';
    } else if (hoursUntilAppointment > -2) { // 2 hours after appointment time
      return 'active';
    } else {
      return 'expired';
    }
  }

  /**
   * Generate meeting instructions for patient
   */
  generateMeetingInstructions(meetingData, patientName, doctorName, appointmentDate, appointmentTime) {
    const appointmentDateTime = new Date(`${appointmentDate}T${appointmentTime}`);
    const formattedDate = appointmentDateTime.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const formattedTime = appointmentDateTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    return {
      title: `Video Consultation with Dr. ${doctorName}`,
      date: formattedDate,
      time: formattedTime,
      meetingUrl: meetingData.meetingUrl,
      meetingId: meetingData.meetingId,
      password: meetingData.meetingPassword,
      instructions: [
        'Click the meeting link 5 minutes before your scheduled time',
        'Ensure you have a stable internet connection',
        'Use a device with camera and microphone',
        'Find a quiet, well-lit space for the consultation',
        'Have your ID ready for verification',
        'Keep your medical records and any test results handy'
      ],
      technicalRequirements: [
        'Stable internet connection (minimum 2 Mbps)',
        'Device with camera and microphone',
        'Updated web browser (Chrome, Firefox, Safari, or Edge)',
        'Allow camera and microphone permissions when prompted'
      ],
      supportContact: {
        phone: process.env.SUPPORT_PHONE || '+1-800-MEDIQ-01',
        email: process.env.SUPPORT_EMAIL || 'support@mediq.com'
      }
    };
  }
}

module.exports = new MeetingLinkService();
