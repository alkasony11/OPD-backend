// Test login first to get a real token
async function testLogin() {
  try {
    console.log('Testing login...');
    const loginResponse = await fetch('http://localhost:5001/api/auth/login', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'alkasony03@gmail.com',
        password: 'admin123'
      })
    });
    
    const loginData = await loginResponse.text();
    console.log('Login status:', loginResponse.status);
    
    if (loginResponse.ok) {
      const parsedData = JSON.parse(loginData);
      console.log('✅ Login successful');
      console.log('User role:', parsedData.user.role);
      
      // Now test departments API with real token
      await testDepartmentsAPI(parsedData.token);
    } else {
      console.log('❌ Login failed:', loginData);
    }
  } catch (error) {
    console.log('❌ Login error:', error.message);
  }
}

// Test the departments API
async function testDepartmentsAPI(token) {
  try {
    console.log('Testing departments API with real token...');
    const response = await fetch('http://localhost:5001/api/admin/departments', {
      method: 'GET',
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.text();
    console.log('Response status:', response.status);
    console.log('Response data:', data);
    
    if (response.ok) {
      console.log('✅ Departments API Response:', JSON.parse(data));
    } else {
      console.log('❌ Departments API Error:', response.status, data);
    }
  } catch (error) {
    console.log('❌ Network Error:', error.message);
  }
}

testLogin();