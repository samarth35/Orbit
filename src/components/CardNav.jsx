import React, { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Orbit as OrbitIcon, Plus } from 'lucide-react';
import './CardNav.css';

export default function CardNav({
  items,
  activeView,
  onNavigate,
  className = '',
  ease = 'power3.out',
  baseColor,
  menuColor,
  buttonBgColor,
  buttonTextColor,
  onQuickCapture
}) {
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const navRef = useRef(null);
  const cardsRef = useRef([]);
  const tlRef = useRef(null);

  const collapsedHeight = () => (window.matchMedia('(max-width: 560px)').matches ? 58 : 64);

  const calculateHeight = () => {
    const navEl = navRef.current;
    if (!navEl) return 260;
    if (window.matchMedia('(max-width: 780px)').matches) {
      const contentEl = navEl.querySelector('.card-nav-content');
      if (contentEl) return collapsedHeight() + contentEl.scrollHeight + 18;
    }
    return 250;
  };

  const createTimeline = () => {
    const navEl = navRef.current;
    if (!navEl) return null;

    gsap.set(navEl, { height: collapsedHeight(), overflow: 'hidden' });
    gsap.set(cardsRef.current, { y: 42, opacity: 0 });

    const timeline = gsap.timeline({ paused: true });
    timeline.to(navEl, { height: calculateHeight, duration: 0.4, ease });
    timeline.to(cardsRef.current, { y: 0, opacity: 1, duration: 0.38, ease, stagger: 0.06 }, '-=0.12');

    return timeline;
  };

  useLayoutEffect(() => {
    const timeline = createTimeline();
    tlRef.current = timeline;
    return () => {
      timeline?.kill();
      tlRef.current = null;
    };
  }, [ease, items]);

  useLayoutEffect(() => {
    const handleResize = () => {
      if (!tlRef.current) return;
      tlRef.current.kill();
      const nextTimeline = createTimeline();
      if (nextTimeline && isExpanded) {
        gsap.set(navRef.current, { height: calculateHeight() });
        nextTimeline.progress(1);
      }
      tlRef.current = nextTimeline;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isExpanded]);

  const toggleMenu = () => {
    const timeline = tlRef.current;
    if (!timeline) return;
    if (!isExpanded) {
      setIsHamburgerOpen(true);
      setIsExpanded(true);
      timeline.play(0);
    } else {
      setIsHamburgerOpen(false);
      timeline.eventCallback('onReverseComplete', () => setIsExpanded(false));
      timeline.reverse();
    }
  };

  const setCardRef = index => element => {
    if (element) cardsRef.current[index] = element;
  };

  const handleNavigate = view => {
    onNavigate?.(view);
    if (isExpanded) toggleMenu();
  };

  return (
    <div className={`card-nav-container ${className}`}>
      <nav
        ref={navRef}
        className={`card-nav ${isExpanded ? 'open' : ''}`}
        style={{ backgroundColor: baseColor }}
      >
        <div className="card-nav-top">
          <button
            type="button"
            className={`hamburger-menu ${isHamburgerOpen ? 'open' : ''}`}
            onClick={toggleMenu}
            aria-label={isExpanded ? 'Close menu' : 'Open menu'}
            aria-expanded={isExpanded}
            style={{ color: menuColor }}
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>

          <button type="button" className="logo-container" onClick={() => handleNavigate('Today')} aria-label="Orbit home">
            <span className="orbit-mark"><OrbitIcon size={19} /></span>
            <span className="orbit-logotype">Orbit</span>
          </button>

          <button
            type="button"
            className="card-nav-cta-button"
            style={{ backgroundColor: buttonBgColor, color: buttonTextColor }}
            onClick={onQuickCapture}
          >
            <Plus size={17} />
            <span>Capture</span>
          </button>
        </div>

        <div className="card-nav-content" aria-hidden={!isExpanded}>
          {(items || []).slice(0, 3).map((item, index) => (
            <div
              key={item.label}
              className="nav-card"
              ref={setCardRef(index)}
              style={{ backgroundColor: item.bgColor, color: item.textColor }}
            >
              <div className="nav-card-label">{item.label}</div>
              <div className="nav-card-links">
                {item.links?.map(link => (
                  <button
                    key={link.label}
                    className={`nav-card-link ${activeView === link.view ? 'active' : ''}`}
                    type="button"
                    aria-label={link.ariaLabel}
                    onClick={() => handleNavigate(link.view)}
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
