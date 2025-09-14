const axios = require('axios');

// Symptom to Department mapping (simplified version - in production, use a proper medical API)
const symptomDepartmentMapping = {
  // General symptoms
  'fever': ['General Medicine', 'Internal Medicine'],
  'headache': ['General Medicine', 'Neurology'],
  'fatigue': ['General Medicine', 'Internal Medicine'],
  'nausea': ['General Medicine', 'Gastroenterology'],
  'vomiting': ['General Medicine', 'Gastroenterology'],
  'dizziness': ['General Medicine', 'Neurology'],
  'weakness': ['General Medicine', 'Internal Medicine'],
  
  // Respiratory symptoms
  'cough': ['Pulmonology', 'General Medicine'],
  'chest pain': ['Cardiology', 'Pulmonology', 'Emergency Medicine'],
  'shortness of breath': ['Pulmonology', 'Cardiology', 'Emergency Medicine'],
  'breathing difficulty': ['Pulmonology', 'Emergency Medicine'],
  'wheezing': ['Pulmonology', 'Allergy & Immunology'],
  'sore throat': ['ENT', 'General Medicine'],
  'runny nose': ['ENT', 'Allergy & Immunology'],
  'nasal congestion': ['ENT', 'Allergy & Immunology'],
  
  // Cardiovascular symptoms
  'heart palpitations': ['Cardiology'],
  'chest tightness': ['Cardiology', 'Pulmonology'],
  'irregular heartbeat': ['Cardiology'],
  'high blood pressure': ['Cardiology', 'Internal Medicine'],
  
  // Gastrointestinal symptoms
  'stomach pain': ['Gastroenterology', 'General Medicine'],
  'abdominal pain': ['Gastroenterology', 'General Medicine'],
  'diarrhea': ['Gastroenterology', 'General Medicine'],
  'constipation': ['Gastroenterology', 'General Medicine'],
  'heartburn': ['Gastroenterology'],
  'indigestion': ['Gastroenterology', 'General Medicine'],
  'bloating': ['Gastroenterology'],
  
  // Neurological symptoms
  'seizures': ['Neurology', 'Emergency Medicine'],
  'memory problems': ['Neurology', 'Psychiatry'],
  'confusion': ['Neurology', 'Emergency Medicine'],
  'numbness': ['Neurology', 'Orthopedics'],
  'tingling': ['Neurology', 'Orthopedics'],
  'muscle weakness': ['Neurology', 'Orthopedics'],
  
  // Orthopedic symptoms
  'joint pain': ['Orthopedics', 'Rheumatology'],
  'back pain': ['Orthopedics', 'Physical Medicine'],
  'neck pain': ['Orthopedics', 'Physical Medicine'],
  'knee pain': ['Orthopedics'],
  'shoulder pain': ['Orthopedics'],
  'hip pain': ['Orthopedics'],
  'swelling': ['Orthopedics', 'General Medicine'],
  
  // Dermatological symptoms
  'rash': ['Dermatology', 'Allergy & Immunology'],
  'skin irritation': ['Dermatology'],
  'acne': ['Dermatology'],
  'moles': ['Dermatology'],
  'hair loss': ['Dermatology', 'Endocrinology'],
  
  // Eye symptoms
  'eye pain': ['Ophthalmology'],
  'vision problems': ['Ophthalmology'],
  'blurred vision': ['Ophthalmology'],
  'eye redness': ['Ophthalmology'],
  'dry eyes': ['Ophthalmology'],
  
  // Ear symptoms
  'ear pain': ['ENT'],
  'hearing loss': ['ENT'],
  'ear discharge': ['ENT'],
  'tinnitus': ['ENT'],
  
  // Dental symptoms
  'toothache': ['Dentistry'],
  'gum pain': ['Dentistry'],
  'jaw pain': ['Dentistry', 'Orthopedics'],
  'dental problems': ['Dentistry'],
  
  // Urological symptoms
  'urinary problems': ['Urology'],
  'frequent urination': ['Urology', 'Endocrinology'],
  'painful urination': ['Urology'],
  'blood in urine': ['Urology', 'Emergency Medicine'],
  
  // Gynecological symptoms
  'menstrual problems': ['Gynecology'],
  'pelvic pain': ['Gynecology', 'Urology'],
  'pregnancy related': ['Gynecology'],
  
  // Pediatric symptoms
  'child fever': ['Pediatrics'],
  'child cough': ['Pediatrics'],
  'child rash': ['Pediatrics', 'Dermatology'],
  'child behavior': ['Pediatrics', 'Psychiatry'],
  
  // Mental health symptoms
  'anxiety': ['Psychiatry', 'Psychology'],
  'depression': ['Psychiatry', 'Psychology'],
  'stress': ['Psychiatry', 'Psychology'],
  'sleep problems': ['Psychiatry', 'Sleep Medicine'],
  'mood changes': ['Psychiatry'],
  
  // Endocrine symptoms
  'weight changes': ['Endocrinology', 'General Medicine'],
  'diabetes': ['Endocrinology'],
  'thyroid problems': ['Endocrinology'],
  'hormonal issues': ['Endocrinology'],
  
  // Emergency symptoms
  'severe pain': ['Emergency Medicine'],
  'unconsciousness': ['Emergency Medicine'],
  'bleeding': ['Emergency Medicine'],
  'injury': ['Emergency Medicine', 'Orthopedics'],
  'poisoning': ['Emergency Medicine'],
  'allergic reaction': ['Emergency Medicine', 'Allergy & Immunology']
};

// Predefined synonym dictionary for symptoms -> base canonical symptom
const symptomSynonyms = {
  // General
  'fever': ['pyrexia', 'high temperature', 'temperature', 'feverish'],
  'headache': ['head ache', 'migraine', 'head pain'],
  'fatigue': ['tiredness', 'exhaustion', 'low energy', 'lethargy'],
  'nausea': ['queasy', 'sick to stomach'],
  'vomiting': ['throwing up', 'emesis'],
  'dizziness': ['lightheaded', 'vertigo'],
  'weakness': ['loss of strength'],

  // Respiratory
  'cough': ['coughing'],
  'chest pain': ['chest ache', 'chest discomfort', 'tight chest'],
  'shortness of breath': ['sob', 'breathless', 'dyspnea', 'breathing difficulty'],
  'wheezing': ['whistling breath'],
  'sore throat': ['throat pain', 'throat ache'],
  'runny nose': ['rhinorrhea', 'running nose'],
  'nasal congestion': ['blocked nose', 'stuffy nose'],

  // Cardiovascular
  'heart palpitations': ['palpitations', 'racing heart', 'pounding heart'],
  'chest tightness': ['tight chest'],
  'high blood pressure': ['hypertension'],

  // Gastrointestinal
  'stomach pain': ['stomach ache', 'tummy ache'],
  'abdominal pain': ['belly pain'],
  'diarrhea': ['loose stools', 'runs'],
  'constipation': ['hard stools', 'no bowel'],
  'heartburn': ['acid reflux', 'acidic'],
  'indigestion': ['dyspepsia'],
  'bloating': ['gas', 'gassy'],

  // Neurological
  'seizures': ['fits', 'convulsions'],
  'memory problems': ['forgetfulness'],
  'numbness': ['loss of sensation'],
  'tingling': ['pins and needles'],

  // Orthopedic
  'joint pain': ['arthralgia'],
  'back pain': ['low back pain', 'lumbago'],
  'neck pain': ['cervical pain'],
  'knee pain': ['pain in knee'],
  'shoulder pain': ['pain in shoulder'],

  // Dermatology
  'rash': ['skin rash', 'eruption'],
  'skin irritation': ['itching', 'pruritus'],
  'hair loss': ['alopecia'],

  // Eye
  'eye pain': ['ocular pain'],
  'blurred vision': ['blurry vision'],

  // Ear
  'hearing loss': ['hard of hearing'],
  'ear discharge': ['ear drainage'],

  // Dental
  'toothache': ['tooth pain'],

  // Urology
  'urinary problems': ['peeing problems'],
  'frequent urination': ['peeing often', 'polyuria'],
  'painful urination': ['dysuria', 'burning urination'],

  // Gynecology
  'menstrual problems': ['period problems', 'irregular periods'],
  'pelvic pain': ['lower abdominal pain'],

  // Mental health
  'anxiety': ['anxious'],
  'depression': ['depressed', 'low mood'],
  'stress': ['stressed'],
  'sleep problems': ['insomnia', 'cant sleep', 'sleeplessness'],

  // Endocrine
  'weight changes': ['weight gain', 'weight loss'],
  'thyroid problems': ['thyroid issue', 'thyroid disorder']
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Expand input text by replacing synonyms with canonical terms for matching
function expandWithSynonyms(symptomsText) {
  let expanded = symptomsText;
  for (const [canonical, syns] of Object.entries(symptomSynonyms)) {
    for (const s of syns) {
      const escaped = s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp(`(?<=^|\b)${escaped}(?=\b)`, 'g');
      expanded = expanded.replace(re, canonical);
    }
  }
  return expanded;
}

// Related departments for each main department
const relatedDepartments = {
  'General Medicine': ['Internal Medicine', 'Family Medicine'],
  'Cardiology': ['Pulmonology', 'Internal Medicine'],
  'Pulmonology': ['Cardiology', 'ENT'],
  'Gastroenterology': ['General Medicine', 'Internal Medicine'],
  'Neurology': ['Psychiatry', 'Orthopedics'],
  'Orthopedics': ['Physical Medicine', 'Neurology'],
  'Dermatology': ['Allergy & Immunology', 'General Medicine'],
  'Ophthalmology': ['Neurology', 'ENT'],
  'ENT': ['Ophthalmology', 'Pulmonology'],
  'Dentistry': ['Orthopedics', 'ENT'],
  'Urology': ['Gynecology', 'General Medicine'],
  'Gynecology': ['Urology', 'Endocrinology'],
  'Pediatrics': ['General Medicine', 'Family Medicine'],
  'Psychiatry': ['Psychology', 'Neurology'],
  'Endocrinology': ['Internal Medicine', 'Gynecology'],
  'Emergency Medicine': ['General Medicine', 'Internal Medicine'],
  'Allergy & Immunology': ['Dermatology', 'ENT'],
  'Internal Medicine': ['General Medicine', 'Family Medicine'],
  'Family Medicine': ['General Medicine', 'Pediatrics'],
  'Physical Medicine': ['Orthopedics', 'Neurology'],
  'Rheumatology': ['Orthopedics', 'Internal Medicine'],
  'Sleep Medicine': ['Psychiatry', 'Neurology'],
  'Psychology': ['Psychiatry', 'Family Medicine']
};

class SymptomAnalysisService {
  /**
   * Analyze symptoms and suggest departments
   * @param {string} symptoms - Free text symptoms description
   * @returns {Object} - Analysis result with suggested departments
   */
  static async analyzeSymptoms(symptoms) {
    try {
      if (!symptoms || typeof symptoms !== 'string') {
        throw new Error('Symptoms text is required');
      }

      const symptomsText = normalizeText(symptoms);
      const normalized = expandWithSynonyms(symptomsText);
      
      // Find matching departments based on symptoms
      const matchedDepartments = new Set();
      const confidenceScores = {};
      
      // Check for exact matches and partial matches
      for (const [symptom, departments] of Object.entries(symptomDepartmentMapping)) {
        if (normalized.includes(symptom)) {
          departments.forEach(dept => {
            matchedDepartments.add(dept);
            confidenceScores[dept] = (confidenceScores[dept] || 0) + 1;
          });
        }
      }
      
      // If no matches found, suggest General Medicine as default
      if (matchedDepartments.size === 0) {
        return {
          primaryDepartment: 'General Medicine',
          relatedDepartments: ['Internal Medicine', 'Family Medicine'],
          confidence: 0.3,
          reasoning: 'No specific symptoms matched. General Medicine recommended for initial assessment.',
          matchedSymptoms: []
        };
      }
      
      // Sort departments by confidence score
      const sortedDepartments = Array.from(matchedDepartments).sort((a, b) => {
        return (confidenceScores[b] || 0) - (confidenceScores[a] || 0);
      });
      
      const primaryDepartment = sortedDepartments[0];
      const primaryConfidence = Math.min(0.9, (confidenceScores[primaryDepartment] || 1) * 0.3);
      
      // Get related departments for the primary department
      const relatedDepts = relatedDepartments[primaryDepartment] || [];
      
      // Add other matched departments as related if they're not already included
      const additionalRelated = sortedDepartments.slice(1, 3).filter(dept => 
        !relatedDepts.includes(dept)
      );
      
      const allRelatedDepartments = [...relatedDepts, ...additionalRelated].slice(0, 3);
      
      // Find matched symptoms for reasoning
      const matchedSymptoms = [];
      for (const [symptom, departments] of Object.entries(symptomDepartmentMapping)) {
        if (normalized.includes(symptom) && departments.includes(primaryDepartment)) {
          matchedSymptoms.push(symptom);
        }
      }
      
      return {
        primaryDepartment,
        relatedDepartments: allRelatedDepartments,
        confidence: primaryConfidence,
        reasoning: `Based on symptoms: ${matchedSymptoms.join(', ')}. ${primaryDepartment} is the most appropriate department.`,
        matchedSymptoms,
        allMatchedDepartments: sortedDepartments
      };
      
    } catch (error) {
      console.error('Symptom analysis error:', error);
      throw new Error('Failed to analyze symptoms');
    }
  }
  
  /**
   * Get all available departments
   * @returns {Array} - List of all departments
   */
  static getAllDepartments() {
    return Object.keys(relatedDepartments);
  }
  
  /**
   * Get department information
   * @param {string} departmentName - Name of the department
   * @returns {Object} - Department information
   */
  static getDepartmentInfo(departmentName) {
    const related = relatedDepartments[departmentName] || [];
    return {
      name: departmentName,
      relatedDepartments: related,
      description: this.getDepartmentDescription(departmentName)
    };
  }
  
  /**
   * Get department description
   * @param {string} departmentName - Name of the department
   * @returns {string} - Department description
   */
  static getDepartmentDescription(departmentName) {
    const descriptions = {
      'General Medicine': 'Primary care for general health issues and initial assessments',
      'Cardiology': 'Heart and cardiovascular system conditions',
      'Pulmonology': 'Lung and respiratory system conditions',
      'Gastroenterology': 'Digestive system and gastrointestinal conditions',
      'Neurology': 'Brain, spinal cord, and nervous system conditions',
      'Orthopedics': 'Bones, joints, muscles, and musculoskeletal conditions',
      'Dermatology': 'Skin, hair, and nail conditions',
      'Ophthalmology': 'Eye and vision conditions',
      'ENT': 'Ear, nose, and throat conditions',
      'Dentistry': 'Teeth, gums, and oral health conditions',
      'Urology': 'Urinary system and male reproductive health',
      'Gynecology': 'Female reproductive health and pregnancy',
      'Pediatrics': 'Medical care for infants, children, and adolescents',
      'Psychiatry': 'Mental health and psychiatric conditions',
      'Endocrinology': 'Hormone and metabolic conditions',
      'Emergency Medicine': 'Urgent and emergency medical care',
      'Allergy & Immunology': 'Allergic reactions and immune system conditions',
      'Internal Medicine': 'Complex internal organ conditions',
      'Family Medicine': 'Comprehensive care for all family members',
      'Physical Medicine': 'Physical therapy and rehabilitation',
      'Rheumatology': 'Joint and autoimmune conditions',
      'Sleep Medicine': 'Sleep disorders and conditions',
      'Psychology': 'Mental health counseling and therapy'
    };
    
    return descriptions[departmentName] || 'Specialized medical care';
  }
}

module.exports = SymptomAnalysisService;