// scraper_adapters.js
// Provides adapter functions for scrapers that don't export a '...ForCalculation' function.

import fbxScraper from './fbx_scraper.js';
import wciScraper from './wci_scraper.js';
import ccfiScraper from './ccfi_scraper.js';

// Helper to format date as YYYY-MM-DD
function formatDate(date) {
  if (!date) return new Date().toISOString().split('T')[0];
  try {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

// Adapter for FBX
async function getFBXDataForCalculationAdapter() {
  try {
    // Attempt to get the global index by passing null or specific pattern
    const data = await fbxScraper.getFBXDataForRoute(null, null); // Assuming this triggers fallback to global
    if (data && data.current_index) {
      return {
        current_index: parseFloat(data.current_index),
        change: data.change ? parseFloat(data.change) : 0,
        index_date: formatDate(data.index_date)
      };
    } else {
      console.warn('FBX Adapter: Could not retrieve global index data.');
      return null;
    }
  } catch (error) {
    console.error('Error in FBX Adapter:', error.message);
    return null;
  }
}

// Adapter for WCI
async function getWCIDataForCalculationAdapter() {
  try {
    // Attempt to get the composite index by passing null or specific pattern
    const data = await wciScraper.getWCIDataForRoute(null, null); // Assuming this triggers fallback to composite
    if (data && data.current_index) {
      return {
        current_index: parseFloat(data.current_index),
        change: data.change ? parseFloat(data.change) : 0,
        index_date: formatDate(data.index_date)
      };
    } else {
      console.warn('WCI Adapter: Could not retrieve composite index data.');
      return null;
    }
  } catch (error) {
    console.error('Error in WCI Adapter:', error.message);
    return null;
  }
}

// Adapter for CCFI
async function getCCFIDataForCalculationAdapter() {
  try {
    // Attempt to get the composite index by passing null or specific pattern
    const data = await ccfiScraper.getCCFIDataForRoute(null, null); // Assuming this triggers fallback to composite
    if (data && data.current_index) {
      // Use the normalizer function if available, otherwise format manually
      const normalizedData = ccfiScraper.normalizeIndexData ? 
          ccfiScraper.normalizeIndexData(data) : 
          {
            current_index: parseFloat(data.current_index),
            change: data.change ? parseFloat(data.change) : 0,
            index_date: formatDate(data.index_date)
          };
      return normalizedData;
    } else {
      console.warn('CCFI Adapter: Could not retrieve composite index data.');
      return null;
    }
  } catch (error) {
    console.error('Error in CCFI Adapter:', error.message);
    return null;
  }
}

export default {
  getFBXDataForCalculationAdapter,
  getWCIDataForCalculationAdapter,
  getCCFIDataForCalculationAdapter
};

