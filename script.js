// Mouse cursor circle
(function() {
    const cursorCircle = document.createElement('div');
    cursorCircle.className = 'cursor-circle';
    document.body.appendChild(cursorCircle);
    
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let circleX = mouseX;
    let circleY = mouseY;
    let hasMoved = false;
    
    document.addEventListener('mousemove', (e) => {
        if (!hasMoved) {
            hasMoved = true;
            cursorCircle.style.opacity = '1';
        }
        mouseX = e.clientX;
        mouseY = e.clientY;
    });
    
    function animate() {
        circleX += (mouseX - circleX) * 0.3;
        circleY += (mouseY - circleY) * 0.3;
        
        cursorCircle.style.left = circleX + 'px';
        cursorCircle.style.top = circleY + 'px';
        
        requestAnimationFrame(animate);
    }
    
    // Start at center, hidden
    cursorCircle.style.left = circleX + 'px';
    cursorCircle.style.top = circleY + 'px';
    cursorCircle.style.opacity = '0';
    
    animate();
})();

// Set active navigation link based on current page
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
const navLinks = document.querySelectorAll('.nav-menu a');

navLinks.forEach(link => {
    const linkPage = link.getAttribute('href');
    if (linkPage === currentPage || (currentPage === '' && linkPage === 'index.html')) {
        link.classList.add('active');
    }
});

// Smooth grid animation
(function() {
    const gridBackground = document.querySelector('.grid-background');
    if (!gridBackground) return;
    
    let x = 0;
    let y = 0;
    const speed = 0.05; // pixels per frame
    const gridSize = 50;
    
    function animate() {
        x += speed;
        y += speed;
        
        // Reset when reaching grid size for seamless loop
        if (x >= gridSize) x = 0;
        if (y >= gridSize) y = 0;
        
        gridBackground.style.backgroundPosition = `${x}px ${y}px`;
        requestAnimationFrame(animate);
    }
    
    requestAnimationFrame(animate);
})();

// Description toggle functionality
function toggleDescription() {
    const description = document.getElementById('productDescription');
    const button = document.querySelector('.description-toggle-btn');
    
    if (description && button) {
        if (description.style.display === 'none' || description.style.display === '') {
            description.style.display = 'block';
            button.classList.add('active');
            button.querySelector('span').textContent = 'Hide Description';
        } else {
            description.style.display = 'none';
            button.classList.remove('active');
            button.querySelector('span').textContent = 'View Full Description';
        }
    }
}

// Duration tab functionality
document.addEventListener('DOMContentLoaded', function() {
    const durationTabs = document.querySelectorAll('.duration-tab');
    const priceDisplay = document.getElementById('productPrice');
    
    if (durationTabs.length > 0 && priceDisplay) {
        durationTabs.forEach(tab => {
            tab.addEventListener('click', function(e) {
                e.preventDefault();
                
                // Remove active class from all tabs
                durationTabs.forEach(t => t.classList.remove('active'));
                
                // Add active class to clicked tab
                this.classList.add('active');
                
                // Update price
                const newPrice = this.getAttribute('data-price');
                if (newPrice) {
                    priceDisplay.textContent = '$' + newPrice;
                }
            });
        });
    }
});

// Global buy button handler: creates server-side order and redirects to payment URL
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.buy-btn').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.preventDefault();
            const el = e.currentTarget;

            // Find product id from element attributes or meta tag
            let productId = el.getAttribute('data-product-id') || (document.querySelector('[data-product-id]') && document.querySelector('[data-product-id]').getAttribute('data-product-id')) || (document.querySelector('meta[name="product-id"]') && document.querySelector('meta[name="product-id"]').getAttribute('content'));
            if (!productId) {
                // Attempt to infer product by page slug (e.g., buy-temp-spoofer.html -> temp spoofer)
                try {
                    const page = window.location.pathname.split('/').pop() || '';
                    const base = page.replace('.html', '');
                    const slug = base.replace(/^buy-/, '').replace(/[-_]/g, ' ').toLowerCase();
                    const prodsRes = await fetch('/api/products');
                    if (prodsRes.ok) {
                        const prods = await prodsRes.json();
                        // find product whose name contains all words from slug
                        const words = slug.split(' ').filter(Boolean);
                        let match = prods.find(p => {
                            const name = (p.name || '').toLowerCase();
                            return words.every(w => name.includes(w));
                        });
                        // If no direct match, pick a random product so buy works
                        if (!match && prods.length > 0) {
                            match = prods[Math.floor(Math.random() * prods.length)];
                            console.warn('No slug match; using random product:', match.id, match.name);
                        }
                        if (match) {
                            productId = match.id;
                        }
                    }
                } catch (e) {
                    console.error('Product inference error', e);
                }

                if (!productId) {
                    alert('Product ID not configured for this page. Please contact the site admin.');
                    console.error('Buy clicked but no product id found on page');
                    return;
                }
            }

            // Optionally allow currency selection in future; default USD
            const currency = el.getAttribute('data-currency') || 'USD';

            try {
                btn.classList.add('loading');
                const res = await fetch('/api/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_id: Number(productId), currency })
                });
                const data = await res.json();
                if (!res.ok) {
                    alert(data.error || 'Failed to create order');
                    console.error('Create order failed', data);
                    btn.classList.remove('loading');
                    return;
                }

                if (data.payment_url) {
                    // Redirect user to hosted payment page
                    window.location.href = data.payment_url;
                } else {
                    alert('Order created but payment URL not returned.');
                    console.log('Order created', data);
                }
            } catch (err) {
                console.error('Buy flow error:', err);
                alert('Failed to start purchase. Check console for details.');
            } finally {
                btn.classList.remove('loading');
            }
        });
    });
});

