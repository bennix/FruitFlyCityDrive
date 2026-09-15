import "./landing.css";

const svg = document.querySelector(".neural-web");
const synapses = svg?.querySelector(".synapses");
const neurons = svg?.querySelector(".neurons");

if (svg && synapses && neurons) {
  const center = { x: 350, y: 350 };
  const points = Array.from({ length: 74 }, (_, index) => {
    const angle = index * 2.39996;
    const radius = 42 + Math.sqrt(index / 73) * 260 * (0.82 + Math.random() * 0.18);
    return {
      x: center.x + Math.cos(angle) * radius * 1.06,
      y: center.y + Math.sin(angle) * radius * 0.78,
    };
  });

  points.forEach((point, index) => {
    points.slice(index + 1).forEach((other, offset) => {
      const distance = Math.hypot(point.x - other.x, point.y - other.y);
      if (distance < 104 && (index + offset) % 3 !== 0) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", point.x);
        line.setAttribute("y1", point.y);
        line.setAttribute("x2", other.x);
        line.setAttribute("y2", other.y);
        line.style.setProperty("--delay", `${((index + offset) % 15) * -0.18}s`);
        synapses.append(line);
      }
    });

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    circle.setAttribute("r", index % 9 === 0 ? 4.5 : 2.1);
    circle.style.setProperty("--delay", `${(index % 18) * -0.13}s`);
    neurons.append(circle);
  });
}

const reveal = new IntersectionObserver(
  (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add("visible")),
  { threshold: 0.14 },
);
document.querySelectorAll(".feature, .model-copy, .final-cta").forEach((item) => reveal.observe(item));
