"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-5" />,
        info: <InfoIcon className="size-5" />,
        warning: <TriangleAlertIcon className="size-5" />,
        error: <OctagonXIcon className="size-5" />,
        loading: <Loader2Icon className="size-5 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--success)",
          "--success-text": "#FFFFFF",
          "--success-border": "var(--success)",
          "--error-bg": "#FEF2F2",
          "--error-text": "#991B1B",
          "--error-border": "#FECACA",
          "--border-radius": "0.875rem",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !text-base !py-4 !px-5 !gap-3",
          actionButton: "!bg-white !text-[#0B1F3A] !font-semibold !h-9 !px-4 !rounded-lg !text-sm",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
