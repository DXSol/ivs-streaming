import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'eventTime',
  standalone: true
})
export class EventTimePipe implements PipeTransform {
  private readonly IST_OFFSET = 5.5 * 60; // IST is UTC+5:30 in minutes

  transform(dateString: string, format: 'full' | 'time' | 'date' = 'full'): string {
    if (!dateString) return '';

    const date = new Date(dateString);
    const userOffset = -date.getTimezoneOffset(); // User's offset in minutes from UTC
    const isUserInIST = userOffset === this.IST_OFFSET;

    if (isUserInIST) {
      // User is in IST, just show the time/date without IST label for cleaner display
      if (format === 'date') {
        return this.formatInTimezone(date, 'Asia/Kolkata', 'date');
      } else if (format === 'time') {
        return this.formatInTimezone(date, 'Asia/Kolkata', 'time');
      } else {
        const istDate = this.formatInTimezone(date, 'Asia/Kolkata', 'date');
        const istTime = this.formatInTimezone(date, 'Asia/Kolkata', 'time');
        return `${istDate} ${istTime}`;
      }
    }

    // User is in different timezone - show full datetime for both IST and local
    const istDate = this.formatInTimezone(date, 'Asia/Kolkata', 'date');
    const istTime = this.formatInTimezone(date, 'Asia/Kolkata', 'time');
    const localDate = this.formatInTimezone(date, undefined, 'date');
    const localTime = this.formatInTimezone(date, undefined, 'time');
    const userTzAbbr = this.getTimezoneAbbr();

    // Format: "Dec 22, 2025 11:13 AM IST / Dec 21, 2025 11:43 PM CST"
    return `${istDate} ${istTime} IST / ${localDate} ${localTime} ${userTzAbbr}`;
  }

  private formatInTimezone(date: Date, timezone: string | undefined, format: 'full' | 'time' | 'date'): string {
    const options: Intl.DateTimeFormatOptions = { timeZone: timezone };

    if (format === 'date') {
      options.month = 'short';
      options.day = 'numeric';
      options.year = 'numeric';
    } else if (format === 'time') {
      options.hour = 'numeric';
      options.minute = '2-digit';
      options.hour12 = true;
    } else {
      options.month = 'short';
      options.day = 'numeric';
      options.year = 'numeric';
      options.hour = 'numeric';
      options.minute = '2-digit';
      options.hour12 = true;
    }

    return new Intl.DateTimeFormat('en-US', options).format(date);
  }

  private getTimezoneAbbr(): string {
    const now = new Date();
    const tzString = now.toLocaleTimeString('en-US', { timeZoneName: 'short' });
    const match = tzString.match(/[A-Z]{2,5}$/);
    return match ? match[0] : 'local';
  }
}
