# File Upload

A file upload component with drag and drop, previewing, and progress tracking.

## Installation

### CLI

```package-install
npx shadcn@latest add @diceui/file-upload
```

### Manual


  
     Install the following dependencies:

     ```package-install
     @radix-ui/react-slot
     ```
  
  
    Copy and paste the following hook into your `hooks` directory.

    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
  FileUploadList,
  FileUploadItem,
  FileUploadItemPreview,
  FileUploadItemMetadata,
  FileUploadItemProgress,
  FileUploadItemDelete,
  FileUploadClear,
} from "@/components/ui/file-upload";

return (
  <FileUpload>
    <FileUploadDropzone />
    <FileUploadTrigger />
    <FileUploadList>
      <FileUploadItem>
        <FileUploadItemPreview />
        <FileUploadItemMetadata />
        <FileUploadItemProgress />
        <FileUploadItemDelete />
      </FileUploadItem>
    </FileUploadList>
    <FileUploadClear />
  </FileUpload>
)
```

## Examples

### With Validation

Validate files with the `onFileValidate` prop on the `Root` component based on type, size, and custom rules. This will override the default file rejection message.


### Direct Upload

Upload files directly with the `onUpload` prop on the `Root` component.


### Circular Progress

Render a circular progress indicator instead of a linear one by enabling the `circular` prop on the `ItemProgress` component.


### Fill Progress

Render a fill progress indicator instead of a linear one by enabling the `fill` prop on the `ItemProgress` component.


### With uploadthing

Integrate with [uploadthing](https://uploadthing.com) for secure, type-safe file uploads with real-time progress tracking.


### With Chat Input

Integrate into a chat input for uploading files. For demo the `Dropzone` is absolutely positioned to cover the entire viewport.


### With Form

Use the `value` and `onValueChange` props to handle file uploads with validation and submission.


## API Reference

### FileUpload

The main container component for the file upload functionality.

> Props: `FileUploadProps`

### FileUploadDropzone

A container for drag and drop functionality.

> Props: `FileUploadDropzoneProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/file-upload)

### FileUploadTrigger

A button that opens the file selection dialog.

> Props: `FileUploadTriggerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/file-upload)

### FileUploadList

A container for displaying uploaded files.

> Props: `FileUploadListProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/file-upload)

### FileUploadItem

Individual file item component.

> Props: `FileUploadItemProps`

### FileUploadItemPreview

Displays a preview of the file, showing an image for image files or an appropriate icon for other file types.

> Props: `FileUploadItemPreviewProps`

### FileUploadItemMetadata

Displays file information such as name, size, and error messages.

> Props: `FileUploadItemMetadataProps`

### FileUploadItemProgress

Shows the upload progress for a file.

> Props: `FileUploadItemProgressProps`

### FileUploadItemDelete

A button to remove a file from the list.

> Props: `FileUploadItemDeleteProps`

### FileUploadClear

A button to clear all files from the list.

> Props: `FileUploadClearProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/file-upload)

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/file-upload)

## Credits

- [Building a Hold to Delete Component](https://emilkowal.ski/ui/building-a-hold-to-delete-component) - For the fill progress indicator.