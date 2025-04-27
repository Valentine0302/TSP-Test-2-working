document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, initializing script...');
  
  // Set current year in footer
  document.getElementById('currentYear').textContent = new Date().getFullYear();
  
  // Load ports and container types
  await loadPorts();
  await loadContainerTypes();
  
  // Set up form submission
  const form = document.getElementById('calculatorForm');
  form.addEventListener('submit', handleFormSubmit);
});

// Load ports from API
async function loadPorts() {
  console.log('Loading ports...');
  try {
    const response = await fetch('/api/ports');
    if (!response.ok) {
      throw new Error('Failed to fetch ports');
    }
    
    const ports = await response.json();
    console.log('Ports loaded:', ports);
    
    // Group ports by region
    const portsByRegion = {};
    ports.forEach(port => {
      if (!portsByRegion[port.region]) {
        portsByRegion[port.region] = [];
      }
      portsByRegion[port.region].push(port);
    });
    
    // Populate origin and destination dropdowns
    const originSelect = document.getElementById('origin');
    const destinationSelect = document.getElementById('destination');
    
    // Clear existing options except the first one
    originSelect.innerHTML = '<option value="">Select origin port</option>';
    destinationSelect.innerHTML = '<option value="">Select destination port</option>';
    
    // Add ports grouped by region
    Object.entries(portsByRegion).forEach(([region, regionPorts]) => {
      const originGroup = document.createElement('optgroup');
      originGroup.label = region;
      
      const destinationGroup = document.createElement('optgroup');
      destinationGroup.label = region;
      
      regionPorts.forEach(port => {
        // Create option for origin
        const originOption = document.createElement('option');
        originOption.value = port.id;
        originOption.textContent = `${port.name}, ${port.country} (${port.id})`;
        originGroup.appendChild(originOption);
        
        // Create option for destination
        const destinationOption = document.createElement('option');
        destinationOption.value = port.id;
        destinationOption.textContent = `${port.name}, ${port.country} (${port.id})`;
        destinationGroup.appendChild(destinationOption);
      });
      
      originSelect.appendChild(originGroup);
      destinationSelect.appendChild(destinationGroup);
    });
  } catch (error) {
    console.error('Error loading ports:', error);
    alert('Failed to load ports. Please refresh the page and try again.');
  }
}

// Load container types from API
async function loadContainerTypes() {
  console.log('Loading container types...');
  try {
    const response = await fetch('/api/container-types');
    if (!response.ok) {
      throw new Error('Failed to fetch container types');
    }
    
    const containerTypes = await response.json();
    console.log('Container types loaded:', containerTypes);
    
    const containerTypeSelect = document.getElementById('containerType');
    
    // Clear existing options except the first one
    containerTypeSelect.innerHTML = '<option value="">Select container type</option>';
    
    // Add container types
    containerTypes.forEach(containerType => {
      const option = document.createElement('option');
      option.value = containerType.id;
      option.textContent = `${containerType.name} - ${containerType.description}`;
      containerTypeSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading container types:', error);
    alert('Failed to load container types. Please refresh the page and try again.');
  }
}

// Handle form submission
async function handleFormSubmit(event) {
  event.preventDefault();
  
  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalButtonText = submitButton.textContent;
  
  // Show loading state
  submitButton.textContent = 'Calculating...';
  submitButton.disabled = true;
  
  try {
    // Get form data
    const formData = new FormData(form);
    const data = {
      originPort: formData.get('origin'),
      destinationPort: formData.get('destination'),
      containerType: formData.get('containerType'),
      weight: 20000, // Добавляем стандартный вес 20 тонн
      email: formData.get('email')
    };
    
    console.log('Sending data to API:', data);
    
    // Call API to calculate rate
    const response = await fetch('/api/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to calculate rate: ${response.status} - ${JSON.stringify(errorData)}`);
    }
    
    const result = await response.json();
    console.log('API response:', result); // Добавляем логирование ответа API
    
    // Display results
    displayResults(data, result);
  } catch (error) {
    console.error('Error:', error);
    alert(`An error occurred while calculating the rate: ${error.message}`);
  } finally {
    // Reset button
    submitButton.textContent = originalButtonText;
    submitButton.disabled = false;
  }
}

// Display calculation results
function displayResults(data, result) {
  console.log('Displaying results:', result); // Добавляем логирование для отладки
  
  // Get port and container names
  const originSelect = document.getElementById('origin');
  const destinationSelect = document.getElementById('destination');
  const containerTypeSelect = document.getElementById('containerType');
  
  const originOption = originSelect.options[originSelect.selectedIndex];
  const destinationOption = destinationSelect.options[destinationSelect.selectedIndex];
  const containerTypeOption = containerTypeSelect.options[containerTypeSelect.selectedIndex];
  
  // Update display elements
  document.getElementById('routeDisplay').textContent = `${originOption.textContent.split(' (')[0]} → ${destinationOption.textContent.split(' (')[0]}`;
  document.getElementById('containerDisplay').textContent = containerTypeOption.textContent.split(' - ')[0];
  document.getElementById('dateDisplay').textContent = new Date().toLocaleDateString();
  
  // Получаем значения ставок из ответа API
  const minRateValue = result.minRate || result.min_rate || 0;
  const maxRateValue = result.maxRate || result.max_rate || 0;
  
  // Определяем среднюю ставку из различных возможных свойств ответа API
  let avgRateValue = 0;
  if (result.rate !== undefined && result.rate !== null) {
    avgRateValue = result.rate;
  } else if (result.avgRate !== undefined && result.avgRate !== null) {
    avgRateValue = result.avgRate;
  } else if (result.avg_rate !== undefined && result.avg_rate !== null) {
    avgRateValue = result.avg_rate;
  } else {
    // Если средняя ставка не найдена в ответе API, вычисляем её как среднее между минимальной и максимальной
    avgRateValue = Math.round((parseFloat(minRateValue) + parseFloat(maxRateValue)) / 2);
  }
  
  console.log('Rate values:', { minRateValue, maxRateValue, avgRateValue }); // Логируем значения для отладки
  
  // Обновляем отображение ставок
  document.getElementById('minRate').textContent = `$${minRateValue}`;
  document.getElementById('maxRate').textContent = `$${maxRateValue}`;
  
  // РАДИКАЛЬНОЕ РЕШЕНИЕ: Полностью заменяем содержимое индикатора ставки
  const rateIndicatorContainer = document.querySelector('.mb-4');
  if (rateIndicatorContainer) {
    // Создаем новую структуру для отображения ставок
    rateIndicatorContainer.innerHTML = `
      <p class="text-sm text-gray-500 mb-1">Rate Range (USD)</p>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">Min: $${minRateValue}</span>
        <span class="text-sm font-medium bg-blue-600 text-white px-3 py-1 rounded">Avg: $${avgRateValue}</span>
        <span class="text-sm font-medium">Max: $${maxRateValue}</span>
      </div>
    `;
    console.log('Replaced rate indicator with new structure');
  } else {
    console.error('Rate indicator container not found');
    
    // Запасной вариант: если не удалось найти контейнер, пробуем обновить только элемент avgRate
    const avgRateElement = document.getElementById('avgRate');
    if (avgRateElement) {
      avgRateElement.textContent = `$${avgRateValue}`;
      console.log('Updated avgRate element with:', `$${avgRateValue}`);
      
      // Делаем элемент более заметным
      avgRateElement.style.fontWeight = 'bold';
      avgRateElement.style.color = 'white';
      avgRateElement.style.backgroundColor = '#2563eb'; // blue-600
      avgRateElement.style.padding = '4px 8px';
      avgRateElement.style.borderRadius = '4px';
      
      // Убедимся, что родительский элемент видим
      const parentElement = avgRateElement.parentElement;
      if (parentElement) {
        parentElement.style.visibility = 'visible';
        parentElement.style.display = 'block';
      }
    } else {
      console.error('avgRate element not found in DOM');
      
      // Крайний случай: добавляем информацию о средней ставке в другое место
      const resultContainer = document.getElementById('resultContainer');
      if (resultContainer) {
        const avgRateInfo = document.createElement('div');
        avgRateInfo.className = 'mt-4 text-center';
        avgRateInfo.innerHTML = `
          <p class="text-lg font-bold">
            Average Rate: <span class="text-blue-600">$${avgRateValue}</span>
          </p>
        `;
        resultContainer.appendChild(avgRateInfo);
        console.log('Added average rate info as separate element');
      }
    }
  }
  
  // Обновляем дополнительную информацию
  const sourceCountElement = document.getElementById('sourceCount');
  if (sourceCountElement) {
    sourceCountElement.textContent = result.sourceCount || result.source_count || '3';
  }
  
  const reliabilityElement = document.getElementById('reliability');
  if (reliabilityElement) {
    let reliabilityValue = result.reliability || result.reliability_score || 0.85;
    // Преобразуем в процентный формат, если это не строка с процентами
    if (typeof reliabilityValue === 'number') {
      reliabilityValue = `${Math.round(reliabilityValue * 100)}%`;
    } else if (!reliabilityValue.toString().includes('%')) {
      reliabilityValue = `${reliabilityValue}%`;
    }
    reliabilityElement.textContent = reliabilityValue;
  }
  
  // Показываем контейнер с результатами
  const resultContainer = document.getElementById('resultContainer');
  if (resultContainer) {
    resultContainer.classList.remove('hidden');
    resultContainer.scrollIntoView({ behavior: 'smooth' });
  } else {
    console.error('resultContainer element not found in DOM');
  }
}
