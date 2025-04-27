// Отладочная версия клиентского JavaScript для калькулятора ставок фрахта
// Включает подробное логирование для диагностики проблем

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM полностью загружен и разобран');
    
    // Получение ссылок на элементы формы
    const originSelect = document.getElementById('origin');
    const destinationSelect = document.getElementById('destination');
    const containerTypeSelect = document.getElementById('container-type');
    const emailInput = document.getElementById('email');
    const calculateButton = document.getElementById('calculate-button');
    const resultContainer = document.getElementById('result-container');
    
    console.log('Элементы формы:', {
        originSelect: originSelect ? 'найден' : 'не найден',
        destinationSelect: destinationSelect ? 'найден' : 'не найден',
        containerTypeSelect: containerTypeSelect ? 'найден' : 'не найден',
        emailInput: emailInput ? 'найден' : 'не найден',
        calculateButton: calculateButton ? 'найден' : 'не найден',
        resultContainer: resultContainer ? 'найден' : 'не найден'
    });
    
    // Загрузка списка портов
    fetchPorts();
    
    // Загрузка типов контейнеров
    fetchContainerTypes();
    
    // Обработчик нажатия кнопки расчета
    if (calculateButton) {
        calculateButton.addEventListener('click', function(event) {
            event.preventDefault();
            console.log('Нажата кнопка расчета');
            calculateRate();
        });
    }
    
    // Функция для загрузки списка портов
    function fetchPorts() {
        console.log('Запрос списка портов...');
        fetch('/api/ports')
            .then(response => {
                console.log('Ответ от API портов:', response.status);
                if (!response.ok) {
                    throw new Error(`Ошибка HTTP: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log(`Получено ${data.length} портов`);
                if (data.length > 0) {
                    console.log('Пример первого порта:', data[0]);
                }
                
                // Группировка портов по регионам и странам
                const portsByRegion = {};
                data.forEach(port => {
                    if (!portsByRegion[port.region]) {
                        portsByRegion[port.region] = {};
                    }
                    if (!portsByRegion[port.region][port.country]) {
                        portsByRegion[port.region][port.country] = [];
                    }
                    portsByRegion[port.region][port.country].push(port);
                });
                
                // Заполнение выпадающих списков
                if (originSelect && destinationSelect) {
                    populatePortSelect(originSelect, portsByRegion);
                    populatePortSelect(destinationSelect, portsByRegion);
                    console.log('Списки портов заполнены');
                } else {
                    console.error('Элементы выбора портов не найдены');
                }
            })
            .catch(error => {
                console.error('Ошибка при загрузке портов:', error);
                alert('Не удалось загрузить список портов. Пожалуйста, обновите страницу или попробуйте позже.');
            });
    }
    
    // Функция для заполнения выпадающего списка портов
    function populatePortSelect(selectElement, portsByRegion) {
        // Очистка списка
        selectElement.innerHTML = '';
        
        // Добавление пустого варианта
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Выберите порт';
        selectElement.appendChild(emptyOption);
        
        // Добавление портов, сгруппированных по регионам и странам
        for (const region in portsByRegion) {
            const regionGroup = document.createElement('optgroup');
            regionGroup.label = region;
            
            for (const country in portsByRegion[region]) {
                const countryPorts = portsByRegion[region][country];
                
                // Если в стране много портов, создаем подгруппу
                if (countryPorts.length > 3) {
                    const countryGroup = document.createElement('optgroup');
                    countryGroup.label = `${country}`;
                    countryGroup.style.marginLeft = '10px';
                    
                    countryPorts.forEach(port => {
                        const option = document.createElement('option');
                        option.value = port.id;
                        option.textContent = port.name;
                        countryGroup.appendChild(option);
                    });
                    
                    regionGroup.appendChild(countryGroup);
                } else {
                    // Если портов мало, добавляем их напрямую в регион
                    countryPorts.forEach(port => {
                        const option = document.createElement('option');
                        option.value = port.id;
                        option.textContent = `${port.name}, ${country}`;
                        regionGroup.appendChild(option);
                    });
                }
            }
            
            selectElement.appendChild(regionGroup);
        }
    }
    
    // Функция для загрузки типов контейнеров
    function fetchContainerTypes() {
        console.log('Запрос типов контейнеров...');
        fetch('/api/container-types')
            .then(response => {
                console.log('Ответ от API типов контейнеров:', response.status);
                if (!response.ok) {
                    throw new Error(`Ошибка HTTP: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log(`Получено ${data.length} типов контейнеров`);
                if (data.length > 0) {
                    console.log('Пример первого типа контейнера:', data[0]);
                }
                
                // Заполнение выпадающего списка
                if (containerTypeSelect) {
                    // Очистка списка
                    containerTypeSelect.innerHTML = '';
                    
                    // Добавление пустого варианта
                    const emptyOption = document.createElement('option');
                    emptyOption.value = '';
                    emptyOption.textContent = 'Выберите тип контейнера';
                    containerTypeSelect.appendChild(emptyOption);
                    
                    // Добавление типов контейнеров
                    data.forEach(containerType => {
                        const option = document.createElement('option');
                        option.value = containerType.id;
                        option.textContent = `${containerType.name} - ${containerType.description}`;
                        containerTypeSelect.appendChild(option);
                    });
                    
                    console.log('Список типов контейнеров заполнен');
                } else {
                    console.error('Элемент выбора типа контейнера не найден');
                }
            })
            .catch(error => {
                console.error('Ошибка при загрузке типов контейнеров:', error);
                alert('Не удалось загрузить список типов контейнеров. Пожалуйста, обновите страницу или попробуйте позже.');
            });
    }
    
    // Функция для валидации email
    function validateEmail(email) {
        console.log('Валидация email:', email);
        return new Promise((resolve, reject) => {
            fetch('/api/validate-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            })
            .then(response => {
                console.log('Ответ от API валидации email:', response.status);
                if (!response.ok) {
                    throw new Error(`Ошибка HTTP: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('Результат валидации email:', data);
                resolve(data);
            })
            .catch(error => {
                console.error('Ошибка при валидации email:', error);
                reject(error);
            });
        });
    }
    
    // Функция для расчета ставки фрахта
    function calculateRate() {
        console.log('Начало расчета ставки фрахта');
        
        // Получение значений из формы
        const origin = originSelect ? originSelect.value : '';
        const destination = destinationSelect ? destinationSelect.value : '';
        const containerType = containerTypeSelect ? containerTypeSelect.value : '';
        const email = emailInput ? emailInput.value : '';
        
        console.log('Данные формы:', { origin, destination, containerType, email });
        
        // Валидация формы
        if (!origin || !destination || !containerType || !email) {
            console.error('Не все поля заполнены');
            alert('Пожалуйста, заполните все поля формы.');
            return;
        }
        
        // Отображение индикатора загрузки
        if (resultContainer) {
            resultContainer.innerHTML = '<div class="loading">Расчет ставки фрахта...</div>';
            resultContainer.style.display = 'block';
        }
        
        // Валидация email
        validateEmail(email)
            .then(validation => {
                if (!validation.isValid) {
                    console.error('Email не прошел валидацию:', validation.message);
                    throw new Error(validation.message);
                }
                
                console.log('Email прошел валидацию, отправка запроса на расчет');
                
                // Отправка запроса на расчет
                return fetch('/api/calculate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        origin,
                        destination,
                        containerType,
                        email
                    })
                });
            })
            .then(response => {
                console.log('Ответ от API расчета:', response.status);
                if (!response.ok) {
                    throw new Error(`Ошибка HTTP: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('Результат расчета:', data);
                
                // Отображение результата
                if (resultContainer) {
                    // Форматирование результата
                    const reliabilityPercent = Math.round(data.reliability * 100);
                    const reliabilityClass = reliabilityPercent >= 80 ? 'high' : (reliabilityPercent >= 60 ? 'medium' : 'low');
                    
                    resultContainer.innerHTML = `
                        <h3>Результат расчета</h3>
                        <div class="result-item">
                            <span class="label">Ставка фрахта:</span>
                            <span class="value">${data.rate} ${data.currency}</span>
                        </div>
                        <div class="result-item">
                            <span class="label">Диапазон ставок:</span>
                            <span class="value">${data.min_rate} - ${data.max_rate} ${data.currency}</span>
                        </div>
                        <div class="result-item">
                            <span class="label">Надежность расчета:</span>
                            <span class="value reliability ${reliabilityClass}">${reliabilityPercent}%</span>
                        </div>
                        <div class="result-item">
                            <span class="label">Источники данных:</span>
                            <span class="value">${data.sources.join(', ')}</span>
                        </div>
                        <div class="result-note">
                            Результат расчета отправлен на ваш email: ${email}
                        </div>
                    `;
                }
            })
            .catch(error => {
                console.error('Ошибка при расчете ставки фрахта:', error);
                
                if (resultContainer) {
                    resultContainer.innerHTML = `
                        <div class="error">
                            <h3>Ошибка</h3>
                            <p>${error.message || 'Не удалось рассчитать ставку фрахта. Пожалуйста, попробуйте позже.'}</p>
                        </div>
                    `;
                }
            });
    }
});
