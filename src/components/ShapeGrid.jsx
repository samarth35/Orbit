import React, { useEffect, useRef } from 'react';
import './ShapeGrid.css';

export default function ShapeGrid({
  direction = 'right',
  speed = 1,
  borderColor = '#999',
  squareSize = 40,
  hoverFillColor = '#222',
  shape = 'square',
  hoverTrailAmount = 0,
  className = ''
}) {
  const canvasRef = useRef(null);
  const requestRef = useRef(null);
  const gridOffset = useRef({ x: 0, y: 0 });
  const hoveredSquare = useRef(null);
  const trailCells = useRef([]);
  const cellOpacities = useRef(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isHex = shape === 'hexagon';
    const isTri = shape === 'triangle';
    const hexHoriz = squareSize * 1.5;
    const hexVert = squareSize * Math.sqrt(3);

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };

    const drawHex = (cx, cy, size) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i;
        const vx = cx + size * Math.cos(angle);
        const vy = cy + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
    };

    const drawCircle = (cx, cy, size) => {
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.closePath();
    };

    const drawTriangle = (cx, cy, size, flip) => {
      ctx.beginPath();
      if (flip) {
        ctx.moveTo(cx, cy + size / 2);
        ctx.lineTo(cx + size / 2, cy - size / 2);
        ctx.lineTo(cx - size / 2, cy - size / 2);
      } else {
        ctx.moveTo(cx, cy - size / 2);
        ctx.lineTo(cx + size / 2, cy + size / 2);
        ctx.lineTo(cx - size / 2, cy + size / 2);
      }
      ctx.closePath();
    };

    const updateCellOpacities = () => {
      const targets = new Map();
      if (hoveredSquare.current) targets.set(`${hoveredSquare.current.x},${hoveredSquare.current.y}`, 1);
      if (hoverTrailAmount > 0) {
        trailCells.current.forEach((cell, index) => {
          const key = `${cell.x},${cell.y}`;
          if (!targets.has(key)) targets.set(key, (trailCells.current.length - index) / (trailCells.current.length + 1));
        });
      }
      targets.forEach((_, key) => {
        if (!cellOpacities.current.has(key)) cellOpacities.current.set(key, 0);
      });
      cellOpacities.current.forEach((opacity, key) => {
        const target = targets.get(key) || 0;
        const next = opacity + (target - opacity) * 0.15;
        if (next < 0.005) cellOpacities.current.delete(key);
        else cellOpacities.current.set(key, next);
      });
    };

    const drawGrid = () => {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;

      if (isHex) {
        const colShift = Math.floor(gridOffset.current.x / hexHoriz);
        const offsetX = ((gridOffset.current.x % hexHoriz) + hexHoriz) % hexHoriz;
        const offsetY = ((gridOffset.current.y % hexVert) + hexVert) % hexVert;
        const cols = Math.ceil(width / hexHoriz) + 3;
        const rows = Math.ceil(height / hexVert) + 3;
        for (let col = -2; col < cols; col += 1) {
          for (let row = -2; row < rows; row += 1) {
            const cx = col * hexHoriz + offsetX;
            const cy = row * hexVert + ((col + colShift) % 2 !== 0 ? hexVert / 2 : 0) + offsetY;
            const alpha = cellOpacities.current.get(`${col},${row}`);
            if (alpha) {
              ctx.globalAlpha = alpha;
              drawHex(cx, cy, squareSize);
              ctx.fillStyle = hoverFillColor;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            drawHex(cx, cy, squareSize);
            ctx.strokeStyle = borderColor;
            ctx.stroke();
          }
        }
      } else {
        const stepX = isTri ? squareSize / 2 : squareSize;
        const stepY = squareSize;
        const offsetX = ((gridOffset.current.x % stepX) + stepX) % stepX;
        const offsetY = ((gridOffset.current.y % stepY) + stepY) % stepY;
        const cols = Math.ceil(width / stepX) + 4;
        const rows = Math.ceil(height / stepY) + 4;
        for (let col = -2; col < cols; col += 1) {
          for (let row = -2; row < rows; row += 1) {
            const x = col * stepX + offsetX;
            const y = row * stepY + offsetY;
            const alpha = cellOpacities.current.get(`${col},${row}`);
            if (alpha) {
              ctx.globalAlpha = alpha;
              ctx.fillStyle = hoverFillColor;
              if (isTri) {
                drawTriangle(x, y + squareSize / 2, squareSize, (col + row) % 2 !== 0);
                ctx.fill();
              } else if (shape === 'circle') {
                drawCircle(x + squareSize / 2, y + squareSize / 2, squareSize);
                ctx.fill();
              } else {
                ctx.fillRect(x, y, squareSize, squareSize);
              }
              ctx.globalAlpha = 1;
            }
            ctx.strokeStyle = borderColor;
            if (isTri) {
              drawTriangle(x, y + squareSize / 2, squareSize, (col + row) % 2 !== 0);
              ctx.stroke();
            } else if (shape === 'circle') {
              drawCircle(x + squareSize / 2, y + squareSize / 2, squareSize);
              ctx.stroke();
            } else {
              ctx.strokeRect(x, y, squareSize, squareSize);
            }
          }
        }
      }
    };

    const updateAnimation = () => {
      const effectiveSpeed = reduceMotion ? 0 : Math.max(speed, 0.1);
      const wrapX = isHex ? hexHoriz * 2 : squareSize;
      const wrapY = isHex ? hexVert : isTri ? squareSize * 2 : squareSize;

      if (direction === 'right') gridOffset.current.x = (gridOffset.current.x - effectiveSpeed + wrapX) % wrapX;
      if (direction === 'left') gridOffset.current.x = (gridOffset.current.x + effectiveSpeed + wrapX) % wrapX;
      if (direction === 'up') gridOffset.current.y = (gridOffset.current.y + effectiveSpeed + wrapY) % wrapY;
      if (direction === 'down') gridOffset.current.y = (gridOffset.current.y - effectiveSpeed + wrapY) % wrapY;
      if (direction === 'diagonal') {
        gridOffset.current.x = (gridOffset.current.x - effectiveSpeed + wrapX) % wrapX;
        gridOffset.current.y = (gridOffset.current.y - effectiveSpeed + wrapY) % wrapY;
      }

      updateCellOpacities();
      drawGrid();
      requestRef.current = requestAnimationFrame(updateAnimation);
    };

    const handleMouseMove = event => {
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor((event.clientX - rect.left) / Math.max(squareSize / 2, 12));
      const row = Math.floor((event.clientY - rect.top) / Math.max(squareSize / 2, 12));
      if (!hoveredSquare.current || hoveredSquare.current.x !== col || hoveredSquare.current.y !== row) {
        if (hoveredSquare.current && hoverTrailAmount > 0) {
          trailCells.current.unshift({ ...hoveredSquare.current });
          if (trailCells.current.length > hoverTrailAmount) trailCells.current.length = hoverTrailAmount;
        }
        hoveredSquare.current = { x: col, y: row };
      }
    };

    const handleMouseLeave = () => {
      hoveredSquare.current = null;
    };

    window.addEventListener('resize', resizeCanvas);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    resizeCanvas();
    requestRef.current = requestAnimationFrame(updateAnimation);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(requestRef.current);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [direction, speed, borderColor, hoverFillColor, squareSize, shape, hoverTrailAmount]);

  return <canvas ref={canvasRef} className={`shapegrid-canvas ${className}`} />;
}
