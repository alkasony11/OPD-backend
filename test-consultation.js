const axios = require('axios');

async function testConsultationAPI() {
  try {
    console.log('🧪 Testing Consultation API...\n');

    // Test data
    const consultationData = {
      chiefComplaint: 'Patient complains of chest pain and shortness of breath',
      historyOfPresentIllness: 'Symptoms started 2 days ago, worse with exertion. No previous cardiac history.',
      physicalExamination: 'Patient appears anxious, vital signs stable, no obvious distress at rest.',
      vitalSigns: {
        bloodPressure: '120/80',
        heartRate: '88 bpm',
        temperature: '98.6°F',
        respiratoryRate: '18/min',
        oxygenSaturation: '98%'
      },
      diagnosis: 'Possible anxiety-related chest pain, rule out cardiac causes',
      treatmentPlan: 'Rest, stress management, follow-up in 1 week',
      medications: 'Prescribed low-dose anxiety medication',
      followUpInstructions: 'Return if symptoms worsen, follow up in 1 week',
      additionalNotes: 'Patient educated about stress management techniques'
    };

    // You would need to replace these with actual values from your database
    const testAppointmentId = '507f1f77bcf86cd799439011'; // Replace with actual appointment ID
    const testToken = 'your-test-token-here'; // Replace with actual token

    console.log('📝 Test consultation data:', JSON.stringify(consultationData, null, 2));

    // Test saving consultation
    console.log('\n💾 Testing consultation save...');
    const saveResponse = await axios.patch(
      `http://localhost:5001/api/doctor/appointments/${testAppointmentId}/consultation`,
      {
        consultationData,
        status: 'consulted'
      },
      {
        headers: { Authorization: `Bearer ${testToken}` }
      }
    );

    console.log('✅ Save response:', saveResponse.data);

    // Test fetching consultation
    console.log('\n📖 Testing consultation fetch...');
    const fetchResponse = await axios.get(
      `http://localhost:5001/api/doctor/appointments/${testAppointmentId}/consultation`,
      {
        headers: { Authorization: `Bearer ${testToken}` }
      }
    );

    console.log('✅ Fetch response:', fetchResponse.data);

    console.log('\n🎉 All consultation tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the test
testConsultationAPI();
