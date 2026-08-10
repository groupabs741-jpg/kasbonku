"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type DatePickerProps = {
  id?: string
  value?: Date
  defaultValue?: Date
  onChange?: (date: Date | undefined) => void
  placeholder?: string
  className?: string
}

function DatePicker({
  id,
  value,
  defaultValue,
  onChange,
  placeholder = "Pilih tanggal",
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [internalDate, setInternalDate] = React.useState<Date | undefined>(
    defaultValue
  )
  const date = value ?? internalDate

  const handleSelect = (nextDate: Date | undefined) => {
    if (value === undefined) setInternalDate(nextDate)
    onChange?.(nextDate)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "h-10 w-full min-w-0 justify-between rounded-2xl border-border/70 bg-input/35 px-3 text-left text-sm font-normal hover:bg-muted/60 dark:bg-input/25",
              !date && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <span className="truncate">
          {date ? format(date, "dd/MM/yyyy") : placeholder}
        </span>
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          onSelect={handleSelect}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
