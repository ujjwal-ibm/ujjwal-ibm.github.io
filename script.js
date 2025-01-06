// Add this at the beginning of your script.js file:

// Navigation handling
document.addEventListener('DOMContentLoaded', function() {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.section');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);

            // Update active states
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Show/hide sections
            sections.forEach(section => {
                if (section.id === targetId) {
                    section.classList.add('active');
                } else {
                    section.classList.remove('active');
                }
            });
        });
    });
});

let scene, camera, renderer;
let spheres = [];
let targetPositions = [];
let textMesh;



const grid = new Map(); // To store occupied positions
const GRID_SIZE = 0.5; // Size of each grid cell (adjust based on sphere sizes)

// Helper function to get grid key for a position
function getGridKey(position) {
    const x = Math.round(position.x / GRID_SIZE);
    const y = Math.round(position.y / GRID_SIZE);
    const z = Math.round(position.z / GRID_SIZE);
    return `${x},${y},${z}`;
}

// Check if position is available
function isPositionAvailable(position, sphereSize) {
    const checkRadius = sphereSize * 1.2; // Add small buffer between spheres
    for(let x = -1; x <= 1; x++) {
        for(let y = -1; y <= 1; y++) {
            for(let z = -1; z <= 1; z++) {
                const checkPos = new THREE.Vector3(
                    position.x + x * GRID_SIZE,
                    position.y + y * GRID_SIZE,
                    position.z + z * GRID_SIZE
                );
                const key = getGridKey(checkPos);
                if(grid.has(key)) {
                    const existingSphere = grid.get(key);
                    const distance = position.distanceTo(existingSphere.position);
                    if(distance < (sphereSize + existingSphere.geometry.parameters.radius)) {
                        return false;
                    }
                }
            }
        }
    }
    return true;
}
const sphereGroups = [
    { count: 800, size: 0.65 },   // Large spheres
    { count: 1600, size: 0.44 },  // Medium spheres
    { count: 2400, size: 0.33 },  // Small spheres
    { count: 3200, size: 0.22 }   // Tiny spheres for gaps
];

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        alpha: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0xB9B9B9);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 2.5;
    document.getElementById('scene-container').appendChild(renderer.domElement);

    camera.position.z = 150;

    // Create HDR-like environment map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
    const envTexture = createHDRBackground();
    const envMap = pmremGenerator.fromEquirectangular(envTexture).texture;

    setupLights();
    createTextGuide();
    createGoldenSpheres(envMap);

    animate();
    setTimeout(startCycle, 1000);

    window.addEventListener('resize', onWindowResize, false);
}

function createHDRBackground() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    const gradient = ctx.createRadialGradient(
        canvas.width/2, canvas.height/2, 0,
        canvas.width/2, canvas.height/2, canvas.width/2
    );
    gradient.addColorStop(0, '#483b00');
    gradient.addColorStop(0.3, '#ae8319');
    gradient.addColorStop(0.6, '#705107');
    gradient.addColorStop(1, '#ce9c1e');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    return texture;
}

function setupLights() {
    const sunLight = new THREE.DirectionalLight(0xfff4e5, 4);
    sunLight.position.set(1, 1, 1);
    scene.add(sunLight);

    const lightColors = [
        0xe6c200,
        0xffd499,
        0xeed500,
        0xd39e00,
        0xb8860b
    ];
    
    for(let i = 0; i < 12; i++) {
        const light = new THREE.PointLight(
            lightColors[i % lightColors.length],
            2,
            250
        );
        light.position.set(
            Math.sin(i * Math.PI/6) * 120,
            Math.cos(i * Math.PI/6) * 120,
            50 + Math.sin(i) * 30
        );
        scene.add(light);
    }

    const ambientLight = new THREE.AmbientLight(0xfffaf0, 1.5);
    scene.add(ambientLight);
}

function createTextGuide() {
    const loader = new THREE.FontLoader();
    loader.load('./gentilis_bold.typeface.json', function(font) {
        const textGeometry = new THREE.TextGeometry('HELLO, I\'M UJJWAL', {
            font: font,
            size: 22,
            height: 2,
            curveSegments: 12,
            bevelEnabled: true,
            bevelThickness: 0.5,
            bevelSize: 0.3,
            bevelSegments: 5
        });

        textGeometry.computeBoundingBox();
        const centerOffset = new THREE.Vector3();
        centerOffset.x = -(textGeometry.boundingBox.max.x + textGeometry.boundingBox.min.x) / 2;
        centerOffset.y = -(textGeometry.boundingBox.max.y + textGeometry.boundingBox.min.y) / 2;
        centerOffset.z = -(textGeometry.boundingBox.max.z + textGeometry.boundingBox.min.z) / 2;

        const material = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.0,
            wireframe: true
        });

        textMesh = new THREE.Mesh(textGeometry, material);
        textMesh.position.copy(centerOffset);
        scene.add(textMesh);

        generateTargetPositions(textGeometry, centerOffset);
    });
}

// Modified generateTargetPositions function
function generateTargetPositions(textGeometry, centerOffset) {
    const positions = textGeometry.attributes.position.array;
    targetPositions = [];
    grid.clear(); // Clear existing grid
    
    // Create a pool of all possible positions
    const positionPool = [];
    const triangleCount = positions.length / 9;
    const samplesPerTriangle = 100; // Increase for more potential positions

    for(let i = 0; i < triangleCount; i++) {
        const baseIndex = i * 9;
        const v1 = new THREE.Vector3(
            positions[baseIndex] + centerOffset.x,
            positions[baseIndex + 1] + centerOffset.y,
            positions[baseIndex + 2] + centerOffset.z
        );
        const v2 = new THREE.Vector3(
            positions[baseIndex + 3] + centerOffset.x,
            positions[baseIndex + 4] + centerOffset.y,
            positions[baseIndex + 5] + centerOffset.z
        );
        const v3 = new THREE.Vector3(
            positions[baseIndex + 6] + centerOffset.x,
            positions[baseIndex + 7] + centerOffset.y,
            positions[baseIndex + 8] + centerOffset.z
        );

        // Generate multiple sample points per triangle
        for(let j = 0; j < samplesPerTriangle; j++) {
            let a = Math.random();
            let b = Math.random();
            if(a + b > 1) {
                a = 1 - a;
                b = 1 - b;
            }
            let c = 1 - a - b;

            const position = new THREE.Vector3()
                .addScaledVector(v1, a)
                .addScaledVector(v2, b)
                .addScaledVector(v3, c);

            positionPool.push(position);
        }
    }

    // Shuffle position pool for random sampling
    for(let i = positionPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positionPool[i], positionPool[j]] = [positionPool[j], positionPool[i]];
    }

    // Place spheres starting with largest
    sphereGroups.sort((a, b) => b.size - a.size).forEach(group => {
        let placedCount = 0;
        let positionIndex = 0;

        while(placedCount < group.count && positionIndex < positionPool.length) {
            const position = positionPool[positionIndex];
            if(isPositionAvailable(position, group.size)) {
                targetPositions.push(position);
                grid.set(getGridKey(position), {
                    position: position.clone(),
                    geometry: { parameters: { radius: group.size } }
                });
                placedCount++;
            }
            positionIndex++;
        }
    });

    // Fill any remaining gaps with smallest spheres
    const smallestSize = sphereGroups[sphereGroups.length - 1].size;
    let extraAttempts = 1000; // Limit extra attempts to prevent infinite loop

    while(targetPositions.length < spheres.length && extraAttempts > 0) {
        const position = positionPool[Math.floor(Math.random() * positionPool.length)];
        if(isPositionAvailable(position, smallestSize)) {
            targetPositions.push(position);
            grid.set(getGridKey(position), {
                position: position.clone(),
                geometry: { parameters: { radius: smallestSize } }
            });
        }
        extraAttempts--;
    }
}



function createGoldenMaterial(envMap) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x8B6914),
        metalness: 1.0,
        roughness: 0.05,
        envMap: envMap,
        envMapIntensity: 4.0,
    });
}

function createGoldenSpheres(envMap) {
    sphereGroups.forEach(group => {
        const material = createGoldenMaterial(envMap);
        const geometry = new THREE.SphereGeometry(group.size, 32, 32);

        for (let i = 0; i < group.count; i++) {
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(
                (Math.random() - 0.5) * 300,
                (Math.random() - 0.5) * 300,
                (Math.random() - 0.5) * 300
            );
            scene.add(sphere);
            spheres.push(sphere);
        }
    });
}

function startCycle() {
    formText(3);
    
    setTimeout(() => {
        explodeToUniverse(2.5);
        setTimeout(() => {
            startCycle();
        }, 5500);
    }, 8000);
}

function formText(duration) {
    spheres.forEach((sphere, i) => {
        if(targetPositions[i]) {
            gsap.to(sphere.position, {
                duration: duration,
                x: targetPositions[i].x,
                y: targetPositions[i].y,
                z: targetPositions[i].z,
                ease: "power2.inOut"
            });
        }
    });
}

function explodeToUniverse(duration) {
    spheres.forEach((sphere) => {
        gsap.to(sphere.position, {
            duration: duration,
            x: (Math.random() - 0.5) * 300,
            y: (Math.random() - 0.5) * 300,
            z: (Math.random() - 0.5) * 300,
            ease: "power2.in"
        });
    });
}

function animate() {
    requestAnimationFrame(animate);

    const time = Date.now() * 0.001;

    spheres.forEach((sphere, index) => {
        if (sphere && sphere.rotation) {
            sphere.rotation.x += 0.01 * Math.sin(time + index * 0.1);
            sphere.rotation.y += 0.01 * Math.cos(time + index * 0.1);
        }
    });

    scene.children.forEach((child, index) => {
        if(child.isPointLight) {
            child.position.x = Math.sin(time + index) * 120;
            child.position.y = Math.cos(time + index) * 120;
            child.position.z = 50 + Math.sin(time * 2 + index) * 30;
        }
    });

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}



init();