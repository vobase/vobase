# QR Code

A flexible QR code component for generating and displaying QR codes with customization options.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/qr-code
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot qrcode
     ```
  
  
     Install the type definitions:

     ```package-install
     @types/qrcode
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hook into your `hooks` directory.

    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  QRCode,
  QRCodeCanvas,
  QRCodeSvg,
  QRCodeImage,
  QRCodeOverlay,
  QRCodeSkeleton,
  QRCodeDownload,
} from "@/components/ui/qr-code";

return (
  <QRCode>
    <QRCodeCanvas />
    <QRCodeSvg />
    <QRCodeImage />
    <QRCodeOverlay />
    <QRCodeSkeleton />
    <QRCodeDownload />
  </QRCode>
)
```
Swap `Canvas` with `Svg` or `Image` to render the qr code in svg and image formats respectively.

## Examples

### Different Formats

Render QR codes as Canvas, SVG, or Image elements.


### Customization

Customize colors, size, and error correction levels.


### Overlay

Add logos, icons, or custom elements to the center of QR codes.


## API Reference

### QRCode

The main container component that provides context for QR code generation.

> Props: `QRCodeProps`

> CSS variables available — see [docs](https://diceui.com/docs/components/qr-code)

### Image

Renders the QR code as an HTML image element.

> Props: `QRCodeImageProps`

### Canvas

Renders the QR code using HTML5 Canvas.

> Props: `QRCodeCanvasProps`

### Svg

Renders the QR code as an SVG element.

> Props: `QRCodeSvgProps`

### Overlay

Overlays content (like logos or icons) in the center of the QR code.

> Props: `QRCodeOverlayProps`

### Skeleton

Displays a loading placeholder while the QR code is being generated. Automatically hides once the QR code is ready.

> Props: `QRCodeSkeletonProps`

### Download

A button component for downloading the QR code.

> Props: `QRCodeDownloadProps`

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/qr-code)

## Error Correction Levels

QR codes support different error correction levels that determine how much of the code can be damaged while still being readable:

- **L (Low)**: ~7% of data can be restored
- **M (Medium)**: ~15% of data can be restored (default)
- **Q (Quartile)**: ~25% of data can be restored
- **H (High)**: ~30% of data can be restored

Higher error correction levels result in denser QR codes but provide better resilience to damage or distortion.

## Usage Notes

- The component uses dynamic imports to avoid SSR issues with the QR code library
- Canvas rendering provides the best performance for static QR codes
- SVG rendering is ideal for scalable, print-ready QR codes
- The download functionality works in all modern browsers
- QR codes are generated client-side for privacy and performance
- Child elements are automatically constrained by the `--qr-code-size` CSS variable to prevent layout issues
- When using the Overlay component, set `level="H"` (High error correction) to ensure the QR code remains scannable with up to 30% coverage