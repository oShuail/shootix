document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // AOS
    // ==========================================
    if (typeof AOS !== 'undefined') {
        AOS.init({ duration: 900, easing: 'ease-out-cubic', once: true, offset: 60 });
    }

    // ==========================================
    // Navbar scroll
    // ==========================================
    const navbar = document.getElementById('navbar');
    const onScroll = () => {
        if (!navbar) return;
        if (window.scrollY > 50) navbar.classList.add('scrolled');
        else if (!navbar.classList.contains('force-scrolled')) navbar.classList.remove('scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // ==========================================
    // Mobile menu
    // ==========================================
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    if (mobileMenuBtn && navbar) {
        mobileMenuBtn.setAttribute('role', 'button');
        mobileMenuBtn.setAttribute('tabindex', '0');
        mobileMenuBtn.setAttribute('aria-label', 'القائمة');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');

        const setMenu = (open) => {
            navbar.classList.toggle('active', open);
            mobileMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            const icon = mobileMenuBtn.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-bars', !open);
                icon.classList.toggle('fa-times', open);
            }
        };
        const toggle = () => setMenu(!navbar.classList.contains('active'));

        mobileMenuBtn.addEventListener('click', toggle);
        mobileMenuBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });

        // Close on link tap, on Escape, and on a tap outside the bar.
        document.querySelectorAll('.nav-links a').forEach(link =>
            link.addEventListener('click', () => setMenu(false)));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') setMenu(false);
        });
        document.addEventListener('click', (e) => {
            if (navbar.classList.contains('active') && !navbar.contains(e.target)) setMenu(false);
        });
    }

    // ==========================================
    // Contact form submit
    // ==========================================
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', () => {
            const btn = contactForm.querySelector('button[type="submit"]');
            if (!btn) return;
            const isRtl = document.documentElement.dir === 'rtl';
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${isRtl ? 'جاري الإرسال...' : 'Sending...'}`;
            btn.disabled = true;
        });
    }

    // ==========================================
    // Active nav highlight
    // Uses IntersectionObserver instead of measuring every section on every
    // scroll event — the old version forced a layout on each frame, which is
    // what made scrolling stutter on phones.
    // ==========================================
    const sections = document.querySelectorAll('section[id]');
    const navAnchors = Array.from(document.querySelectorAll('.nav-links a'))
        .filter(a => (a.getAttribute('href') || '').startsWith('#'));

    if (sections.length && navAnchors.length && 'IntersectionObserver' in window) {
        const visible = new Set();
        const setActive = () => {
            // The section closest to the top of the viewport wins.
            let best = null;
            visible.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const top = el.getBoundingClientRect().top;
                if (!best || Math.abs(top) < Math.abs(best.top)) best = { id, top };
            });
            navAnchors.forEach(a => a.classList.toggle('active', best && a.getAttribute('href') === '#' + best.id));
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) visible.add(e.target.id);
                else visible.delete(e.target.id);
            });
            setActive();
        }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });

        sections.forEach(s => observer.observe(s));
    }

    // ==========================================
    // LIGHTBOX GALLERY
    // ==========================================
    initLightbox();

    // ==========================================
    // V3 cinematic layer
    // ==========================================
    initScrollProgress();
    loadManagedGallery();
});


function initLightbox() {
    // All containers whose images should open in a lightbox.
    // Each selector = one navigable group (left/right stays inside that group).
    const containerSelector = '.gallery-grid, .portfolio-row, .portfolio-grid';
    const containers = document.querySelectorAll(containerSelector);
    if (containers.length === 0) return;

    // Build lightbox DOM (once)
    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML = `
        <button class="lightbox-close" aria-label="Close"><i class="fas fa-times"></i></button>
        <button class="lightbox-nav lightbox-prev" aria-label="Previous"><i class="fas fa-chevron-left"></i></button>
        <button class="lightbox-nav lightbox-next" aria-label="Next"><i class="fas fa-chevron-right"></i></button>
        <img class="lightbox-img" src="" alt="">
        <span class="lightbox-counter"></span>
    `;
    document.body.appendChild(lightbox);

    const lbImg = lightbox.querySelector('.lightbox-img');
    const lbClose = lightbox.querySelector('.lightbox-close');
    const lbPrev = lightbox.querySelector('.lightbox-prev');
    const lbNext = lightbox.querySelector('.lightbox-next');
    const lbCounter = lightbox.querySelector('.lightbox-counter');

    let activeGroup = [];   // images in the current group
    let currentIndex = 0;

    function collectGroup(container) {
        // Get all <img> inside this specific container
        activeGroup = Array.from(container.querySelectorAll('img'));
    }

    function openLightbox(container, imgEl) {
        collectGroup(container);
        const idx = activeGroup.indexOf(imgEl);
        if (idx === -1) return;
        currentIndex = idx;
        updateLightbox();
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }

    function updateLightbox() {
        const img = activeGroup[currentIndex];
        // Use data-full if present (for hi-res), else original src
        lbImg.src = img.dataset.full || img.src;
        lbImg.alt = img.alt || '';
        lbCounter.textContent = activeGroup.length > 1
            ? `${currentIndex + 1} / ${activeGroup.length}`
            : '';
        lbPrev.style.display = activeGroup.length <= 1 ? 'none' : '';
        lbNext.style.display = activeGroup.length <= 1 ? 'none' : '';
    }

    function goNext() {
        currentIndex = (currentIndex + 1) % activeGroup.length;
        updateLightbox();
    }
    function goPrev() {
        currentIndex = (currentIndex - 1 + activeGroup.length) % activeGroup.length;
        updateLightbox();
    }

    // Attach click listeners to every container
    containers.forEach(container => {
        container.addEventListener('click', (e) => {
            // Find the clicked image (could be nested inside a card div)
            const img = e.target.closest('img');
            if (!img) return;

            // If the image is inside an <a> link, prevent navigation
            const link = e.target.closest('a');
            if (link) e.preventDefault();

            openLightbox(container, img);
        });
    });

    // Close
    lbClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });

    // Nav
    lbNext.addEventListener('click', (e) => { e.stopPropagation(); goNext(); });
    lbPrev.addEventListener('click', (e) => { e.stopPropagation(); goPrev(); });

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowRight') goNext();
        if (e.key === 'ArrowLeft') goPrev();
    });
}

/* ==========================================
   V3 — scroll progress hairline
   ========================================== */
function initScrollProgress() {
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    document.body.appendChild(bar);
    const update = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = max > 0 ? `${(window.scrollY / max) * 100}%` : '0%';
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
}

/* ==========================================
   V3 — admin-managed gallery
   Pulls images uploaded through the admin panel and
   appends them to the matching portfolio / gallery
   sections. Fails silently on static hosting.
   ========================================== */
function loadManagedGallery() {
    const targets = document.querySelectorAll('[data-category]');
    if (targets.length === 0 || !window.fetch) return;
    const isEnglish = document.documentElement.lang !== 'ar';

    fetch('/api/gallery')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no backend'))))
        .then(({ images }) => {
            if (!Array.isArray(images) || images.length === 0) return;

            targets.forEach((grid) => {
                const category = grid.dataset.category;
                const mine = images
                    .filter((img) => img.category === category)
                    // Images flagged "featured" in the admin panel lead the section.
                    .sort((a, b) => (b.featured === true) - (a.featured === true));
                if (mine.length === 0) return;

                const isRow = grid.classList.contains('portfolio-row');
                const frag = document.createDocumentFragment();

                mine.forEach((img) => {
                    const title = (isEnglish ? img.titleEn : img.title) || img.titleEn || img.title || '';

                    const picture = document.createElement('img');
                    picture.src = img.src;
                    picture.alt = title;
                    picture.loading = 'lazy';
                    picture.decoding = 'async';
                    picture.className = 'managed-img';
                    // Fade in once decoded so the grid never flashes a broken frame.
                    picture.addEventListener('load', () => picture.classList.add('loaded'));
                    // A single dead image must not leave a gap in the portfolio.
                    picture.addEventListener('error', () => {
                        (isRow ? picture.closest('.portfolio-card') : picture)?.remove();
                    });

                    if (isRow) {
                        const card = document.createElement('div');
                        card.className = 'portfolio-card';
                        picture.classList.add('portfolio-card-img');
                        const heading = document.createElement('h4');
                        heading.className = 'portfolio-card-title';
                        heading.textContent = title;
                        card.append(picture, heading);
                        frag.appendChild(card);
                    } else {
                        frag.appendChild(picture);
                    }
                });

                grid.appendChild(frag);
            });
        })
        .catch(() => { /* static hosting or backend down — keep the built-in images */ });
}
