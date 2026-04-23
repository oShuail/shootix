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
        mobileMenuBtn.addEventListener('click', () => {
            navbar.classList.toggle('active');
            const icon = mobileMenuBtn.querySelector('i');
            if (icon) { icon.classList.toggle('fa-bars'); icon.classList.toggle('fa-times'); }
        });
        document.querySelectorAll('.nav-links a').forEach(link => {
            link.addEventListener('click', () => {
                if (navbar.classList.contains('active')) {
                    navbar.classList.remove('active');
                    const icon = mobileMenuBtn.querySelector('i');
                    if (icon) { icon.classList.add('fa-bars'); icon.classList.remove('fa-times'); }
                }
            });
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
    // ==========================================
    const sections = document.querySelectorAll('section[id]');
    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            if (window.pageYOffset >= (section.offsetTop - section.clientHeight / 3)) {
                current = section.getAttribute('id');
            }
        });
        document.querySelectorAll('.nav-links a').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (!href.startsWith('#')) return;
            a.classList.remove('active');
            if (href.substring(1) === current) a.classList.add('active');
        });
    }, { passive: true });

    // ==========================================
    // LIGHTBOX GALLERY
    // ==========================================
    initLightbox();
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
