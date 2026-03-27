import React, { Suspense, useState, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useVideoTexture, Text } from '@react-three/drei';
import * as THREE from 'three';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import * as bodySegmentation from '@tensorflow-models/body-segmentation';

const ASPECT_RATIO = 9 / 16;

const maskShader = {
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tMask;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // Canvas Image Data is top-down, WebGL texture UVS are usually bottom-up.
      // We invert the Y coordinate for the mask if it's rendered upside down,
      // but if the video is ALSO top-down (HTML element), they match.
      // We will adjust based on standard canvas-to-WebGL projection (often Y-flipped).
      vec4 maskColor = texture2D(tMask, vec2(vUv.x, 1.0 - vUv.y));
      // maskColor is white for person, black for background
      gl_FragColor = vec4(color.rgb, maskColor.r);
    }
  `
};

function SceneComponents({ src, segmenter }: { src: string; segmenter: any }) {
  const texture = useVideoTexture(src, { muted: true, loop: true, start: true, crossOrigin: "Anonymous" });
  const { viewport } = useThree();

  // "Object-fit: cover" logic for R3F planes to perfectly fill the screen
  let w = viewport.width;
  let h = viewport.width / ASPECT_RATIO;
  if (h < viewport.height) {
     h = viewport.height;
     w = viewport.height * ASPECT_RATIO;
  }
  
  // Dynamically scale text size based on the video width to perfectly match the screenshot ratios
  const fSize = w * 0.28;

  // Mask Generation
  // Initialize the canvas and texture synchronously so they are available immediately.
  // Using useRef/useEffect delays it, meaning the shader gets a blank texture that it never re-reads!
  const canvasRef = useRef<HTMLCanvasElement>(
    typeof document !== 'undefined' ? document.createElement('canvas') : ({} as any)
  );

  const maskTexture = React.useMemo(() => {
    const canvas = canvasRef.current;
    canvas.width = 256;
    canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.format = THREE.RGBAFormat;
    // Don't auto-generate mipmaps because we update it every frame
    tex.generateMipmaps = false;
    return tex;
  }, []);

  const isProcessingRef = useRef(false);

  useFrame(async () => {
    if (isProcessingRef.current) return;
    if (!segmenter || !texture.image || !canvasRef.current || !maskTexture) return;
    const videoElement = texture.image;
    
    // TF.js often looks at element.width, not just element.videoWidth.
    if (videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
      if (videoElement.width !== videoElement.videoWidth) {
         videoElement.width = videoElement.videoWidth;
         videoElement.height = videoElement.videoHeight;
      }

      isProcessingRef.current = true;
      try {
        const segmentations = await segmenter.segmentPeople(videoElement);
        if (segmentations && segmentations.length > 0) {
            const foregroundColor = {r: 255, g: 255, b: 255, a: 255};
            const backgroundColor = {r: 0, g: 0, b: 0, a: 255};
            
            // Generate Array of ImageData from tensors (creates immense CPU/GPU sync load if not cleaned up)
            const maskImageData = await bodySegmentation.toBinaryMask(segmentations, foregroundColor, backgroundColor);
            
            // WARNING: Writing to canvasRef.current.width CLEARS the canvas context and triggers WebGLTexture reallocation!
            // Only update it if the dimensions actually changed!
            const canvas = canvasRef.current;
            let canvasResized = false;
            if (canvas.width !== maskImageData.width) {
                canvas.width = maskImageData.width;
                canvasResized = true;
            }
            if (canvas.height !== maskImageData.height) {
                canvas.height = maskImageData.height;
                canvasResized = true;
            }

            const ctx = canvas.getContext('2d');
            if (ctx) {
                // If it was resized, properties of context reset. We just putImageData immediately.
                ctx.putImageData(maskImageData, 0, 0);
                if (canvasResized) {
                   // Three.js caches WebGL buffers! If canvas size changes after initial initialization,
                   // we MUST dispose the texture so ThreeJS builds a fresh 1080x1920 (etc) block
                   // instead of forcing glCopySubTextureCHROMIUM on a tiny 256x256 buffer!
                   maskTexture.dispose();
                }
                maskTexture.needsUpdate = true;
            }

            // GPU Memory cleanup: Tensors hold massive WebGL buffers for these masks!
            for (const seg of segmentations) {
               if (seg.mask) {
                   if (typeof seg.mask.dispose === 'function') seg.mask.dispose();
                   else if (typeof seg.mask.close === 'function') seg.mask.close();
                   
                   // Fallback for explicitly drawing down WebGL underlying arrays
                   if (typeof seg.mask.toTensor === 'function') {
                       const t = await seg.mask.toTensor();
                       t.dispose(); // Delete the tensor representing the mask
                   }
               }
            }
        }
      } catch(e) {
          console.error("Segmentation error", e);
      } finally {
          isProcessingRef.current = false;
      }
    }
  });

  return (
    <group>
      {/* Layer 1: Background Video. Offset infinitesimally closer backwards to prevent massive perspective scaling */}
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>

      {/* Layer 2: 3D Text (behind person). Set effectively flush to Layer 1. */}
      {/* Using dynamic sizes ensures it scales responsively and doesn't get cut arbitrarily */}
      <group position={[0, fSize * 0.25, 0]}>
        <Text position={[0, fSize * 0.9, 0]} fontSize={fSize * 0.95} fontWeight="bold" letterSpacing={-0.05} lineHeight={0.9} color="#FFD700" anchorX="center" anchorY="middle" outlineWidth={fSize * 0.03} outlineColor="#000000">
          THIS
        </Text>
        <Text position={[0, 0, 0]} fontSize={fSize * 0.95} fontWeight="bold" letterSpacing={-0.05} lineHeight={0.9} color="#FFD700" anchorX="center" anchorY="middle" outlineWidth={fSize * 0.03} outlineColor="#000000">
          APP
        </Text>
        <Text position={[0, -fSize * 1.15, 0]} fontSize={fSize * 1.05} fontWeight={900} letterSpacing={-0.05} lineHeight={0.9} color="#FFD700" anchorX="center" anchorY="middle" outlineWidth={fSize * 0.033} outlineColor="#000000">
          CREATES
        </Text>
        <Text position={[0, -fSize * 2.2, 0]} fontSize={fSize * 1.05} fontWeight={900} letterSpacing={-0.05} lineHeight={0.9} color="#FFD700" anchorX="center" anchorY="middle" outlineWidth={fSize * 0.033} outlineColor="#000000">
          REELS
        </Text>
      </group>

      {/* Layer 3: Foreground Person (masked video). Offset microscopically forward */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[w, h]} />
        <shaderMaterial
          attach="material"
          vertexShader={maskShader.vertexShader}
          fragmentShader={maskShader.fragmentShader}
          transparent={true}
          uniforms={{
            tDiffuse: { value: texture },
            tMask: { value: maskTexture }
          }}
        />
      </mesh>
      
      <ambientLight intensity={1} />
    </group>
  );
}

function App() {
  const [segmenter, setSegmenter] = useState<any>(null);
  const [loadingMsg, setLoadingMsg] = useState("Initializing TFjs & Model...");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await tf.setBackend('webgl');
        await tf.ready();
        const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
        const segmenterConfig = {
          runtime: 'tfjs' as const,
          modelType: 'general' as const
        };
        const seg = await bodySegmentation.createSegmenter(model, segmenterConfig);
        if (active) {
            setSegmenter(seg);
            setLoadingMsg("");
        }
      } catch (err) {
        console.error(err);
        setLoadingMsg("Error loading model.");
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {segmenter && (
          <Canvas camera={{ position: [0, 0, 5], fov: 60 }} gl={{ alpha: false }}>
            <Suspense fallback={null}>
              <SceneComponents src="/input_video.mp4" segmenter={segmenter} />
            </Suspense>
          </Canvas>
      )}
      <div style={{ position: 'absolute', top: 20, left: 20, color: 'white', zIndex: 10, textShadow: '1px 1px 2px black', fontFamily: 'sans-serif' }}>
        <h2>Wabisabi Pipeline</h2>
        <p>Text Behind Person Effect</p>
        <p>{loadingMsg}</p>
      </div>
    </div>
  );
}

export default App;
