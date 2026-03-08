/**
 * Intersection Observer for scroll reveal animations
 */

export function initRevealObserver(): void {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  // Observe all elements with .reveal class
  document.querySelectorAll('.reveal').forEach((el, i) => {
    // Stagger animation delays
    const delay = (i % 4) * 80;
    (el as HTMLElement).style.transitionDelay = `${delay}ms`;
    observer.observe(el);
  });
}
