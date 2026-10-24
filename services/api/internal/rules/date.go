package rules

import (
	"fmt"
	"time"
)

// Date is a civil (calendar) date with no time zone. All dates in the rules
// engine are IST calendar dates (EC-15: the server clock in Asia/Kolkata is
// the source of truth). Internally a Date is the number of days since
// 1970-01-01, which makes arithmetic exact and identical to the TS mirror.
type Date struct{ days int }

const (
	minYear = 1900
	maxYear = 2200
)

var ist = time.FixedZone("IST", 5*3600+1800)

// TodayIST returns the IST calendar date of t.
func TodayIST(t time.Time) Date {
	y, m, d := t.In(ist).Date()
	return DateFromYMD(y, int(m), d)
}

func isLeap(y int) bool { return (y%4 == 0 && y%100 != 0) || y%400 == 0 }

func daysInMonth(y, m int) int {
	switch m {
	case 2:
		if isLeap(y) {
			return 29
		}
		return 28
	case 4, 6, 9, 11:
		return 30
	default:
		return 31
	}
}

// daysFromCivil is Howard Hinnant's algorithm (years >= 1 only; the parser
// limits years to [1900, 2200]).
func daysFromCivil(y, m, d int) int {
	if m <= 2 {
		y--
	}
	era := y / 400
	yoe := y - era*400
	mp := (m + 9) % 12
	doy := (153*mp+2)/5 + d - 1
	doe := yoe*365 + yoe/4 - yoe/100 + doy
	return era*146097 + doe - 719468
}

func civilFromDays(z int) (int, int, int) {
	z += 719468
	era := z / 146097
	doe := z - era*146097
	yoe := (doe - doe/1460 + doe/36524 - doe/146096) / 365
	y := yoe + era*400
	doy := doe - (365*yoe + yoe/4 - yoe/100)
	mp := (5*doy + 2) / 153
	d := doy - (153*mp+2)/5 + 1
	m := mp + 3
	if m > 12 {
		m -= 12
	}
	if m <= 2 {
		y++
	}
	return y, m, d
}

// DateFromYMD builds a date; the caller guarantees validity.
func DateFromYMD(y, m, d int) Date { return Date{days: daysFromCivil(y, m, d)} }

// ParseDate parses a strict YYYY-MM-DD string.
func ParseDate(s string) (Date, error) {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return Date{}, fmt.Errorf("invalid date %q", s)
	}
	y, ok1 := atoiDigits(s[0:4])
	m, ok2 := atoiDigits(s[5:7])
	d, ok3 := atoiDigits(s[8:10])
	if !ok1 || !ok2 || !ok3 || y < minYear || y > maxYear || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m) {
		return Date{}, fmt.Errorf("invalid date %q", s)
	}
	return DateFromYMD(y, m, d), nil
}

// ParseYear parses a strict 4-digit year.
func ParseYear(s string) (int, bool) {
	if len(s) != 4 {
		return 0, false
	}
	y, ok := atoiDigits(s)
	if !ok || y < minYear || y > maxYear {
		return 0, false
	}
	return y, true
}

func atoiDigits(s string) (int, bool) {
	n := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + int(c-'0')
	}
	return n, len(s) > 0
}

// YMD returns year, month, day.
func (d Date) YMD() (int, int, int) { return civilFromDays(d.days) }

func (d Date) String() string {
	y, m, dd := d.YMD()
	return fmt.Sprintf("%04d-%02d-%02d", y, m, dd)
}

// AddDays adds n calendar days.
func (d Date) AddDays(n int) Date { return Date{days: d.days + n} }

// AddMonths adds n calendar months, clamping the day to the end of the month
// (31 Aug + 6 months = 28/29 Feb).
func (d Date) AddMonths(n int) Date {
	y, m, dd := d.YMD()
	total := y*12 + (m - 1) + n
	ny := total / 12
	nm := total%12 + 1
	if dim := daysInMonth(ny, nm); dd > dim {
		dd = dim
	}
	return DateFromYMD(ny, nm, dd)
}

// DaysUntil returns other - d in days.
func (d Date) DaysUntil(other Date) int { return other.days - d.days }

// Before reports d < o.
func (d Date) Before(o Date) bool { return d.days < o.days }

// After reports d > o.
func (d Date) After(o Date) bool { return d.days > o.days }

// AgeOn returns completed years of a person born on dob, on date on. A 29 Feb
// birthday is reached on 1 Mar in non-leap years.
func AgeOn(dob, on Date) int {
	by, bm, bd := dob.YMD()
	oy, om, od := on.YMD()
	age := oy - by
	if om < bm || (om == bm && od < bd) {
		age--
	}
	return age
}

// BirthdayAt returns the first date on which a person born on dob has
// completed `years` years (consistent with AgeOn).
func BirthdayAt(dob Date, years int) Date {
	by, bm, bd := dob.YMD()
	y := by + years
	if bm == 2 && bd == 29 && !isLeap(y) {
		return DateFromYMD(y, 3, 1)
	}
	return DateFromYMD(y, bm, bd)
}
